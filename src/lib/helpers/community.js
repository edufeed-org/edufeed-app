import { AddUserToFollowSet, RemoveUserFromFollowSet } from 'applesauce-actions/actions';
import { actionRunnerOptimistic } from '$lib/stores/action-runner.svelte.js';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { manager } from '$lib/stores/accounts.svelte';
import { publishEvent } from '$lib/services/publish-service.js';
import { probeCommunitiesFollowSet } from '$lib/helpers/follow-set-probe.js';
import * as m from '$lib/paraglide/messages';

const COMMUNITIES_SET_ID = 'communities';

/**
 * Thrown when a join/leave needs the user's communities follow set but the
 * network could neither deliver it nor confirm it doesn't exist. Creating one
 * then would replace the real list on every relay, so the action fails and
 * the user can retry once their relays answer.
 */
export class FollowSetUnavailableError extends Error {
  constructor() {
    super('Your communities list could not be loaded. Check your connection and try again.');
    this.name = 'FollowSetUnavailableError';
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  if (error instanceof FollowSetUnavailableError) return m.communities_list_unavailable();
  return error instanceof Error ? error.message : 'Unknown error occurred';
}

/** @type {Promise<void> | null} */
let ensureInflight = null;
/** @type {string | null} */
let ensureInflightPubkey = null;

/**
 * Ensure the kind 30000 follow set with d="communities" exists in EventStore.
 * Works around an applesauce bug where AddUserToFollowSet generates a random
 * d-tag when auto-creating a non-existent follow set.
 *
 * Optimistic once the set is known: when it's already in EventStore the check
 * is synchronous, and the bootstrap publish is fire-and-forget. But a local
 * miss must first be confirmed against the network (see
 * probeCommunitiesFollowSet) — that's the one path where blocking is cheaper
 * than data loss. When the network can't confirm either way, this throws
 * FollowSetUnavailableError instead of guessing.
 *
 * Single-flight per pubkey: two concurrent first-joins (e.g. two tabs, or two
 * calls before the network check resolves) share one in-flight confirmation
 * + bootstrap instead of each racing to create its own empty follow set.
 */
export async function ensureFollowSetExists() {
  if (!manager.active) return;
  const pubkey = manager.active.pubkey;

  if (ensureInflight && ensureInflightPubkey === pubkey) return ensureInflight;

  ensureInflightPubkey = pubkey;
  ensureInflight = ensureFollowSetExistsInner(pubkey).finally(() => {
    ensureInflight = null;
    ensureInflightPubkey = null;
  });
  return ensureInflight;
}

/**
 * @param {string} pubkey
 */
async function ensureFollowSetExistsInner(pubkey) {
  // Synchronous lookup — no subscription, no microtask hop.
  if (eventStore.getReplaceable(30000, pubkey, COMMUNITIES_SET_ID)) return;

  // Local miss ≠ absence, and neither is silence: only relays that ANSWERED
  // "not here" license creating a replaceable that would overwrite the user's
  // real list on every relay (2026-07-16 and 2026-09-30 wipes).
  const probe = await probeCommunitiesFollowSet(pubkey);
  if (probe === 'found') return;
  if (probe === 'unknown') throw new FollowSetUnavailableError();

  // The network check awaited above can take seconds — if the active account
  // changed meanwhile, bootstrapping now would sign an empty follow set for
  // the NEW account, whose absence was never confirmed (data-loss risk).
  if (manager.active?.pubkey !== pubkey) return;

  const factory = createAppEventFactory({ signer: manager.active.signer });
  const built = await factory.build({ kind: 30000, tags: [['d', COMMUNITIES_SET_ID]] });
  // Back-dated by one second: joinCommunity's AddUserToFollowSet runs within
  // the same second as this bootstrap, and NIP-01 resolves equal-created_at
  // replaceables by LOWEST id — a coin flip that silently kept this empty
  // list over the actual follow half the time (journey-test bug #9). One
  // second earlier makes any subsequent update strictly newer.
  const template = { ...built, created_at: Math.floor(Date.now() / 1000) - 1 };
  const signed = await factory.sign(template);

  // Insert locally first so AddUserToFollowSet can read it immediately.
  eventStore.add(signed);

  // Fire-and-forget publish — relay errors are logged, never thrown.
  publishEvent(signed).catch((err) => {
    console.error('Failed to publish initial communities follow-set', err);
  });
}

/**
 * Join a community by adding its pubkey to the user's follow set (kind 30000, d="communities").
 *
 * Uses the optimistic ActionRunner: the signed event is inserted into EventStore
 * synchronously (so the UI updates immediately) and the relay publish runs in
 * the background. Failures during sign still propagate; relay publish failures
 * are logged but not surfaced to the caller.
 *
 * @param {string} communityPubkey - The pubkey of the community to join
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function joinCommunity(communityPubkey) {
  if (!communityPubkey) {
    return { success: false, error: 'Community pubkey is required' };
  }

  try {
    await ensureFollowSetExists();
    await actionRunnerOptimistic.run(AddUserToFollowSet, communityPubkey, COMMUNITIES_SET_ID);
    return { success: true };
  } catch (error) {
    console.error('Failed to join community:', error);
    return {
      success: false,
      error: describeError(error)
    };
  }
}

/**
 * Join multiple communities in a single atomic operation.
 * Passes all pubkeys as an array to AddUserToFollowSet, producing one event with all p-tags.
 * @param {string[]} communityPubkeys - The pubkeys of the communities to join
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function joinCommunities(communityPubkeys) {
  if (!communityPubkeys?.length) {
    return { success: false, error: 'At least one community pubkey is required' };
  }

  try {
    await ensureFollowSetExists();
    await actionRunnerOptimistic.run(AddUserToFollowSet, communityPubkeys, COMMUNITIES_SET_ID);
    return { success: true };
  } catch (error) {
    console.error('Failed to join communities:', error);
    return {
      success: false,
      error: describeError(error)
    };
  }
}

/**
 * Leave a community by removing its pubkey from the user's follow set (kind 30000, d="communities")
 * @param {string} communityPubkey - The pubkey of the community to leave
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function leaveCommunity(communityPubkey) {
  if (!communityPubkey) {
    return { success: false, error: 'Community pubkey is required' };
  }

  try {
    await ensureFollowSetExists();
    await actionRunnerOptimistic.run(RemoveUserFromFollowSet, communityPubkey, COMMUNITIES_SET_ID);
    return { success: true };
  } catch (error) {
    console.error('Failed to leave community:', error);
    return {
      success: false,
      error: describeError(error)
    };
  }
}
