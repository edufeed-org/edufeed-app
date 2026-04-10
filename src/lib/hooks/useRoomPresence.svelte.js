/**
 * Room presence hook — subscribes to kind 10312 presence events
 * for a room and returns reactive list of present pubkeys.
 */
import { SvelteMap } from 'svelte/reactivity';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
import { pruneStalePresence } from '$lib/helpers/meet.js';

const PRESENCE_KIND = 10312;
const PRUNE_INTERVAL_MS = 30_000;
const MAX_AGE_SECONDS = 90;

/**
 * Hook: Subscribe to room presence and return reactive list of present pubkeys.
 * @param {() => string} getRoomCoordinate - Reactive getter for room coordinate
 * @param {() => string} getCommunityPubkey - Reactive getter for community pubkey
 * @returns {() => string[]} Reactive getter for array of present pubkeys
 */
export function useRoomPresence(getRoomCoordinate, getCommunityPubkey) {
  /** @type {import('svelte/reactivity').SvelteMap<string, number>} */
  let presenceMap = new SvelteMap();
  let presentPubkeys = $state(/** @type {string[]} */ ([]));

  /** @type {ReturnType<typeof setInterval> | null} */
  let pruneTimer = null;

  $effect(() => {
    const coordinate = getRoomCoordinate();
    const communityPubkey = getCommunityPubkey();
    if (!coordinate || !communityPubkey) return;

    presenceMap.clear();
    presentPubkeys = [];

    const relays = getCommunikeyRelays();

    // Subscribe to presence events via pool.subscription
    // pool.subscription() emits SubscriptionResponse which includes "EOSE" strings
    const sub = pool
      .subscription(relays, [{ kinds: [PRESENCE_KIND], '#a': [coordinate] }])
      .subscribe((response) => {
        if (typeof response === 'string') return; // skip EOSE
        const event = /** @type {import('nostr-tools').NostrEvent} */ (response);
        eventStore.add(event);
        const existing = presenceMap.get(event.pubkey);
        if (!existing || event.created_at > existing) {
          presenceMap.set(event.pubkey, event.created_at);
          presentPubkeys = Array.from(presenceMap.keys());
        }
      });

    // Prune stale entries periodically
    pruneTimer = setInterval(() => {
      const pruned = pruneStalePresence(presenceMap, MAX_AGE_SECONDS);
      if (pruned.size !== presenceMap.size) {
        presenceMap = new SvelteMap(pruned);
        presentPubkeys = Array.from(pruned.keys());
      }
    }, PRUNE_INTERVAL_MS);

    return () => {
      sub.unsubscribe();
      if (pruneTimer) clearInterval(pruneTimer);
      presenceMap.clear();
      presentPubkeys = [];
    };
  });

  return () => presentPubkeys;
}
