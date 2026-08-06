// Reactive kind:39000 for a community's NIP-29 channels.
//
// Ties the three pure pieces together: plan the requests per relay, run them
// through the pool, collect the results under the key the rail looks up. All
// the decisions live in those modules; this file is the wiring, deliberately
// thin so there is little here that tests cannot reach.
//
// State is $state.raw: the values are applesauce/nostr events from an external
// store, and holding those in deep $state lets a memoising helper write a
// Symbol onto them from inside a $derived — which crashes the runtime
// (see 061c05c9, the /groups page).
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { metadataRequestsByRelay } from './channel-metadata-requests.js';
import { subscribeChannelMetadata } from './channel-metadata-subscribe.js';

/**
 * @param {() => Array<{id: string, relay: string}>} getPointers
 * @returns {() => {byKey: Record<string, any>, failedRelays: string[]}}
 */
export function useChannelMetadata(getPointers) {
  /** @type {Record<string, any>} */
  let byKey = $state.raw({});
  /** @type {string[]} */
  let failedRelays = $state.raw([]);

  $effect(() => {
    const requests = metadataRequestsByRelay(getPointers());
    // Drop what the previous pointer set collected: a channel that is no
    // longer listed must not keep drawing itself from a stale event.
    byKey = {};
    failedRelays = [];
    if (requests.length === 0) return;

    // Accumulate into PLAIN locals and only ever WRITE the reactive state.
    // Reading `byKey` in here to spread it would make this effect depend on
    // what it writes, and a relay that answers synchronously then loops until
    // Svelte's update-depth guard fires (caught by the rail's own test).
    // A plain array rather than a Set on purpose: svelte/prefer-svelte-reactivity
    // would push a Set here to SvelteSet, which is reactive — the very thing
    // this accumulator must not be. Relay counts are tiny, so includes() is
    // the cheaper answer anyway.
    /** @type {Record<string, any>} */
    const collected = {};
    /** @type {string[]} */
    const failed = [];

    return subscribeChannelMetadata({
      requests,
      subscribe: (relay, filter) => pool.relay(relay).request(filter, { timeout: 8000 }),
      onMetadata: (key, event) => {
        collected[key] = event;
        byKey = { ...collected };
      },
      onError: (relay) => {
        if (failed.includes(relay)) return;
        failed.push(relay);
        failedRelays = [...failed];
      }
    });
  });

  return () => ({ byKey, failedRelays });
}
