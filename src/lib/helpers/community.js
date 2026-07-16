import { AddUserToFollowSet, RemoveUserFromFollowSet } from 'applesauce-actions/actions';
import { actionRunnerOptimistic } from '$lib/stores/action-runner.svelte.js';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { manager } from '$lib/stores/accounts.svelte';
import { publishEvent } from '$lib/services/publish-service.js';
import { addressLoader } from '$lib/loaders/base.js';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { getWriteRelays } from '$lib/services/relay-service.svelte.js';

const COMMUNITIES_SET_ID = 'communities';

// Worst-case latency added to a join when the user truly has no follow set
// yet and at least one relay hangs. Existing users' sets resolve as soon as
// any relay (or the IDB cache) answers.
const FOLLOW_SET_LOOKUP_TIMEOUT = 5_000;

/**
 * Confirm against cache + relays whether the user's communities follow set
 * exists anywhere, before we dare to bootstrap a fresh one.
 *
 * A kind 30000 event with a newer created_at REPLACES the old list on every
 * relay it reaches, so treating a local EventStore miss as "the user has no
 * follow set" destroys their memberships whenever the loaders simply haven't
 * finished (or failed) fetching it. Queries lookup relays plus the user's
 * NIP-65 write relays; resolves true the moment the event lands in
 * EventStore, false once the loader completes (or the timeout fires) empty.
 *
 * @param {string} pubkey
 * @returns {Promise<boolean>}
 */
async function followSetExistsOnNetwork(pubkey) {
  const writeRelays = await getWriteRelays(pubkey).catch(() => []);
  const relays = [...new Set([...getAllLookupRelays(), ...writeRelays])];

  return new Promise((resolve) => {
    let settled = false;
    /** @type {import('rxjs').Subscription | undefined} */
    let storeSub;
    /** @type {import('rxjs').Subscription | undefined} */
    let loaderSub;

    const found = () => Boolean(eventStore.getReplaceable(30000, pubkey, COMMUNITIES_SET_ID));
    const settle = (/** @type {boolean} */ result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Defer teardown: settle() can fire synchronously inside subscribe(),
      // before the subscription variables are assigned.
      queueMicrotask(() => {
        storeSub?.unsubscribe();
        loaderSub?.unsubscribe();
      });
      resolve(result);
    };

    const timer = setTimeout(() => settle(found()), FOLLOW_SET_LOOKUP_TIMEOUT);

    // Resolves fastest: fires as soon as the event lands from ANY source
    // (IDB cache, this loader, or a concurrent loader elsewhere in the app).
    storeSub = eventStore.replaceable(30000, pubkey, COMMUNITIES_SET_ID).subscribe((event) => {
      if (event) settle(true);
    });

    loaderSub = addressLoader({
      kind: 30000,
      pubkey,
      identifier: COMMUNITIES_SET_ID,
      relays
    }).subscribe({
      complete: () => settle(found()),
      error: () => settle(found())
    });
  });
}

/**
 * Ensure the kind 30000 follow set with d="communities" exists in EventStore.
 * Works around an applesauce bug where AddUserToFollowSet generates a random
 * d-tag when auto-creating a non-existent follow set.
 *
 * Optimistic once the set is known: when it's already in EventStore the check
 * is synchronous, and the bootstrap publish is fire-and-forget. But a local
 * miss must first be confirmed against the network (see
 * followSetExistsOnNetwork) — that's the one path where blocking is cheaper
 * than data loss.
 */
export async function ensureFollowSetExists() {
  if (!manager.active) return;
  const pubkey = manager.active.pubkey;

  // Synchronous lookup — no subscription, no microtask hop.
  if (eventStore.getReplaceable(30000, pubkey, COMMUNITIES_SET_ID)) return;

  // Local miss ≠ absence. Confirm before creating a replaceable that would
  // overwrite the user's real list on every relay.
  if (await followSetExistsOnNetwork(pubkey)) return;

  const factory = createAppEventFactory({ signer: manager.active.signer });
  const template = await factory.build({ kind: 30000, tags: [['d', COMMUNITIES_SET_ID]] });
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
      error: error instanceof Error ? error.message : 'Unknown error occurred'
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
      error: error instanceof Error ? error.message : 'Unknown error occurred'
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
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}
