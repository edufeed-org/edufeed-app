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
import { untrack } from 'svelte';
import { normalizeURL } from 'applesauce-core/helpers/url';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { metadataRequestsByRelay } from './channel-metadata-requests.js';
import { subscribeChannelMetadata } from './channel-metadata-subscribe.js';
import { raceRelayKey } from './relay-key-race.js';

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
  // uses for the directory read. $state.raw: written by effect 1, read by
  // effect 2. Effect 1 also carries earlier answers forward, and reads them
  // UNTRACKED for that — a tracked read of a value the same effect assigns
  // re-triggers it every run (Svelte's update-depth guard fired on any account
  // with channel pointers, 2026-09-09).
  /** @type {Record<string, string[]>} */
  let authorsByRelay = $state.raw({});
  // Relays effect 2 may safely request metadata for: NIP-11 has answered
  // (with or without a key) OR the race window above has expired with no
  // answer at all. A relay that WILL answer, just not yet, is deliberately
  // NOT ready — requesting its metadata unpinned in that gap is exactly how
  // a forged kind:39000 got collected (and drawn) before the pin ever
  // applied. $state.raw, written by effect 1 (which reads it untracked, see
  // above), read by effect 2.
  /** @type {string[]} */
  let readyRelays = $state.raw([]);

  // Effect 1 — races each relay's NIP-11 key through the shared bounded
  // primitive (armada's C6 shape). Deliberately does NOT reset a relay's
  // entry in authorsByRelay/readyRelays just because this effect reran —
  // only a relay that dropped OUT of the pointer set has its entry cleared.
  // A relay whose key already resolved must not regress to unpinned because
  // the pointer list itself re-emitted for an unrelated reason; that
  // regression is exactly the shape of window this guard exists to close.
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
    if (relays.length === 0) {
      authorsByRelay = {};
      readyRelays = [];
      return;
    }

    // Drop entries for relays no longer in the set; keep every other entry
    // exactly as it is until a fresh answer replaces it. Both reads are
    // untracked on purpose: this effect assigns these two values below, and a
    // tracked read would make each run schedule the next one.
    const previousAuthors = untrack(() => authorsByRelay);
    const previousReady = untrack(() => readyRelays);
    /** @type {Record<string, string[]>} */
    const collected = {};
    for (const relay of relays)
      if (relay in previousAuthors) collected[relay] = previousAuthors[relay];
    authorsByRelay = collected;
    /** @type {string[]} */
    const ready = previousReady.filter((relay) => relays.includes(relay));
    readyRelays = ready;

    /** @param {string} relay */
    const markReady = (relay) => {
      if (ready.includes(relay)) return;
      ready.push(relay);
      readyRelays = [...ready];
    };

    const teardowns = relays.map((relay) =>
      raceRelayKey(relay, {
        onAuthors: (authors) => {
          collected[relay] = authors;
          authorsByRelay = { ...collected };
        },
        onReady: () => markReady(relay)
      })
    );
    return () => teardowns.forEach((teardown) => teardown());
  });

  // Effect 2 — the metadata itself, requested only for relays effect 1 has
  // marked ready, and pinned once (or as soon as) effect 1 resolves the
  // relay's key.
  $effect(() => {
    const pointers = getPointers();
    const resolvedAuthors = authorsByRelay;
    const ready = readyRelays;
    // Pointers on a relay that is not yet ready are excluded from this run
    // entirely — not requested unpinned, not requested at all — until effect
    // 1 marks that relay ready (key resolved or race window expired) and
    // this effect re-runs.
    const readyPointers = pointers.filter((p) => ready.includes(normalizeURL(p.relay)));
    const requests = metadataRequestsByRelay(readyPointers, (relay) => resolvedAuthors[relay]);
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
