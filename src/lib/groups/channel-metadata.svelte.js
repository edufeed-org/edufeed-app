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
import { normalizeURL } from 'applesauce-core/helpers/url';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { metadataRequestsByRelay } from './channel-metadata-requests.js';
import { subscribeChannelMetadata } from './channel-metadata-subscribe.js';
import { relayMetadataAuthors } from './relay-directory.js';

/**
 * @param {() => Array<{id: string, relay: string}>} getPointers
 * @returns {() => {byKey: Record<string, any>, failedRelays: string[]}}
 */
export function useChannelMetadata(getPointers) {
  /** @type {Record<string, any>} */
  let byKey = $state.raw({});
  /** @type {string[]} */
  let failedRelays = $state.raw([]);
  // The relay's own NIP-11 key per relay, so kind:39000 is pinned to the
  // relay that would legitimately sign it — same rule relay-directory.js
  // uses for the directory read. $state.raw: written only here, in effect
  // 1; read only in effect 2 below. Neither effect reads what IT writes, so
  // this can never loop (same split relay-directory.svelte.js documents).
  /** @type {Record<string, string[]>} */
  let authorsByRelay = $state.raw({});

  // Effect 1 — NIP-11 for every relay the pointers touch.
  $effect(() => {
    // Plain array dedup rather than Set, on purpose (see the note above
    // `useChannelMetadata`'s own accumulator further down): a Set here would
    // be pushed to SvelteSet by lint, which is reactive — not what a
    // hook-local dedup pass needs to be.
    /** @type {string[]} */
    const relays = [];
    for (const relay of getPointers()
      .map((p) => normalizeURL(p.relay))
      .filter(Boolean)) {
      if (!relays.includes(relay)) relays.push(relay);
    }
    authorsByRelay = {};
    if (relays.length === 0) return;

    /** @type {Record<string, string[]>} */
    const collected = {};
    const subs = relays.map((relay) =>
      pool.relay(relay).information$.subscribe({
        next: (/** @type {any} */ info) => {
          collected[relay] = relayMetadataAuthors(info);
          authorsByRelay = { ...collected };
        },
        // A relay that refuses NIP-11 simply has no pin — the request below
        // still goes out, unpinned, same as a relay that never answers.
        error: () => {}
      })
    );
    return () => subs.forEach((sub) => sub.unsubscribe());
  });

  // Effect 2 — the metadata itself, pinned once (or as soon as) effect 1
  // resolves the relay's key.
  $effect(() => {
    const pointers = getPointers();
    const resolvedAuthors = authorsByRelay;
    const requests = metadataRequestsByRelay(pointers, (relay) => resolvedAuthors[relay]);
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
