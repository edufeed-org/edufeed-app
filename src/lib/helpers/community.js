import { AddUserToFollowSet, RemoveUserFromFollowSet } from 'applesauce-actions/actions';
import { actionRunnerOptimistic } from '$lib/stores/action-runner.svelte.js';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { manager } from '$lib/stores/accounts.svelte';
import { publishEvent } from '$lib/services/publish-service.js';

const COMMUNITIES_SET_ID = 'communities';

/**
 * Ensure the kind 30000 follow set with d="communities" exists in EventStore.
 * Works around an applesauce bug where AddUserToFollowSet generates a random
 * d-tag when auto-creating a non-existent follow set.
 *
 * Optimistic: when the set is missing, we sign an empty follow set, insert it
 * into EventStore synchronously, and fire the publish in the background. The
 * caller (joinCommunity / leaveCommunity) gets control back as soon as the
 * event is locally visible — we never block on a relay round-trip.
 */
export async function ensureFollowSetExists() {
  if (!manager.active) return;
  const pubkey = manager.active.pubkey;

  // Synchronous lookup — no subscription, no microtask hop.
  if (eventStore.getReplaceable(30000, pubkey, COMMUNITIES_SET_ID)) return;

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
