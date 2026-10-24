/**
 * Base loaders that bootstrap EventStore with relay knowledge, plus the two
 * one-shot request primitives every "latest N" surface uses.
 *
 * - `fetchEvents(relays, filters, { cache })` — one request (optionally seeded
 *   from the IDB cache), events into the EventStore, completes when the relays
 *   answer. This is what lists, detail pages, stats, deletion lookups and
 *   relay/blossom lists semantically are. Nothing here pages.
 * - `fetchOutbox(outboxes, filter)` — the same for an outbox map (relay →
 *   users), requesting each relay once per newly seen author set.
 *
 * Surfaces that scroll (discover feeds, the dashboard relay feed) use
 * `createTimelineFeed` from `./timeline-feed.js` instead — the applesauce v7
 * window loader with prefetch-driven paging and per-relay status.
 */
import { EMPTY, defer, from, isObservable, merge, mergeAll, mergeMap, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import {
  createAddressLoader,
  createEventLoader,
  createUnifiedEventLoader
} from 'applesauce-loaders/loaders';
import { mapEventsToStore } from 'applesauce-core/observable';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getAllLookupRelays, getEventLoaderLookupRelays } from '$lib/helpers/relay-helper.js';
import { cacheRequest } from '$lib/stores/event-cache.svelte.js';
import { createRevalidatingCacheRequest } from '$lib/helpers/cache-revalidate.js';

/**
 * @typedef {import('nostr-tools').Filter} Filter
 * @typedef {import('nostr-tools').Event} NostrEvent
 * @typedef {import('applesauce-core/helpers/relay-selection').OutboxMap} OutboxMap
 */

/**
 * Pool wrapper for one-shot requests.
 *
 * v6 removed the pool-level eoseTimeout (synthetic per-relay EOSE). v7's
 * default group.request() complete strategy (`completeAfterIdle`: 3s grace
 * after the first EOSE, then 1.5s idle, 15s cap) covers the healthy case; the
 * explicit timeout caps the all-relays-dead case, and catchError converts the
 * resulting TimeoutError — or v7's RelayGroupError when every relay failed —
 * into clean completion so callers can treat "done" uniformly.
 *
 * @param {string[]} relays
 * @param {Filter[]} filters
 * @returns {import('rxjs').Observable<any>}
 */
export const timedPool = (relays, filters) =>
  pool.request(relays, filters, { timeout: 10_000 }).pipe(catchError(() => EMPTY));

/** @param {Filter | Filter[]} filters */
const asList = (filters) => (Array.isArray(filters) ? filters : [filters]);

/**
 * One-shot request: the given relays (through `timedPool`) and, with
 * `cache: true`, the IDB cache for the same filters. Every event is added to
 * the shared EventStore; the observable emits the new ones and completes once
 * the relays have answered (or the 10 s cap hit). Put `limit` in the filter.
 *
 * Never errors: relay failures and timeouts complete the stream (`timedPool`
 * swallows them) and the cache leg catches its own failures, so subscribe
 * without an error handler — one would be dead code.
 *
 * @param {string[]} relays
 * @param {Filter | Filter[]} filters
 * @param {{ cache?: boolean }} [opts]
 * @returns {import('rxjs').Observable<NostrEvent>}
 */
export function fetchEvents(relays, filters, { cache = false } = {}) {
  const list = asList(filters);
  const cache$ = cache ? defer(() => from(cacheRequest(list))).pipe(mergeAll()) : EMPTY;
  return merge(cache$, timedPool(relays, list)).pipe(mapEventsToStore(eventStore, true));
}

/**
 * One-shot request across an outbox map (relay → users). Each relay is asked
 * for `filter` restricted to its users; when the map emits again (the
 * OutboxModel re-emits as kind-10002s arrive) a known relay is asked only for
 * its added users and a new relay for all of its users. Completes once the
 * map has completed and every request has answered.
 *
 * @param {OutboxMap | import('rxjs').Observable<OutboxMap>} outboxes
 * @param {Omit<Filter, 'authors'>} filter
 * @returns {import('rxjs').Observable<NostrEvent>}
 */
export function fetchOutbox(outboxes, filter) {
  /** @type {Map<string, Set<string>>} relay → authors already requested there */
  const asked = new Map();
  const maps$ = isObservable(outboxes) ? outboxes : of(outboxes);
  return maps$.pipe(
    mergeMap((outboxMap) => {
      /** @type {import('rxjs').Observable<NostrEvent>[]} */
      const requests = [];
      for (const [relay, users] of Object.entries(outboxMap)) {
        const seen = asked.get(relay) ?? new Set();
        const added = users.map((u) => u.pubkey).filter((pubkey) => !seen.has(pubkey));
        if (added.length === 0) continue;
        for (const pubkey of added) seen.add(pubkey);
        asked.set(relay, seen);
        requests.push(fetchEvents([relay], { ...filter, authors: added }));
      }
      return requests.length > 0 ? merge(...requests) : EMPTY;
    })
  );
}

// lookupRelays is applesauce's fallback-on-miss slot and must include profile
// indexer relays (e.g. purplepag.es) so kind 0 lookups can resolve when the
// author's profile isn't on the app content relays.
//
// Resolved per request, NOT at loader creation: these loaders are built at
// module load, before /api/config has been merged into runtimeConfig, and
// applesauce v6 reads the `lookupRelays` option exactly once when the loader
// is created. A plain getter here was therefore snapshotted as `[]`, which
// left the EventStore fallback loader (`eventStore.replaceable()` /
// `eventStore.profile()` on a cache miss) with nothing to ask — e.g. a
// signed-out /c visit in gated mode could never see a community's newer
// kind-10222 that only a fallback relay held. `unwrap()` re-subscribes an
// Observable for every request, so `defer` reads the live config each time.
const lookupRelays$ = defer(() => of(getEventLoaderLookupRelays()));

// Stale-while-revalidate: the address loader stops at the first source that
// yields an address, so a plain `cacheRequest` would make every cached
// replaceable final for as long as the row lives in IDB. This wrapper returns
// the cached events untouched and re-requests each cached address once per
// session with `cache: false`, which skips the cache step and goes straight to
// the relay hints / lookup relays. Newer versions land in the EventStore (and
// back in IDB) through the normal pipeline; an unchanged or missing relay copy
// leaves the cached one in place. Regular events are immutable and get no
// revalidation (see cache-revalidate.js).
const revalidatingCacheRequest = createRevalidatingCacheRequest(cacheRequest, (pointers) => {
  for (const pointer of pointers) {
    addressLoader({ ...pointer, cache: false }).subscribe({ error: () => {} });
  }
});

// Standalone address loader for direct use in components/loaders
export const addressLoader = createAddressLoader(pool, {
  eventStore,
  cacheRequest: revalidatingCacheRequest,
  lookupRelays: lookupRelays$
});

// Standalone event-by-ID loader for direct use.
// bufferTime: 0 dispatches the relay request on the next microtask instead of
// waiting the default 1s — same-tick calls still batch, but a single detail-page
// fetch no longer burns a full second of its timeout budget before connecting.
export const eventLoader = createEventLoader(pool, {
  eventStore,
  cacheRequest,
  bufferTime: 0
});

// Unified loader for EventStore - handles both EventPointer and AddressPointer.
// Drives eventStore.profile() / eventStore.replaceable() auto-loading, so
// lookupRelays must include profile indexer relays (see addressLoader above).
// Shares the revalidating cache request so `eventStore.replaceable()` /
// `eventStore.profile()` cache hits are refreshed too.
const unifiedLoader = createUnifiedEventLoader(pool, {
  eventStore,
  cacheRequest: revalidatingCacheRequest,
  lookupRelays: lookupRelays$
});
eventStore.eventLoader = unifiedLoader;

/**
 * The NIP-09 deletion events of SEVERAL authors at once, from all lookup
 * relays (app relays + fallback), so deletions are found regardless of which
 * relays the author published them to.
 *
 * The batched form exists because deletions by OTHER people were never loaded
 * anywhere: the single-author form is called only by the calendar paths, and
 * only for the active user. Everything else relied on `hydrateDeletions()`,
 * which only replays kind-5s already sitting in IDB. The effect is that a
 * resource its author deleted keeps rendering for anyone holding a stale copy
 * — and stays shareable, which is how a repost pointing at a resource deleted
 * 17 days earlier got published (laoc, 2026-08-24).
 *
 * Feeding the eventStore is the whole job: applesauce's DeleteManager then
 * drops the deleted events out of every TimelineModel by itself.
 *
 * One filter for the whole batch, not one REQ per author — a REQ per rendered
 * card is what starves a relay connection.
 *
 * @param {string[]} pubkeys - Authors whose deletions to load
 * @returns {import('rxjs').Observable<NostrEvent>}
 */
export const fetchAuthorsDeletions = (pubkeys) =>
  fetchEvents(getAllLookupRelays(), {
    kinds: [5],
    authors: pubkeys,
    limit: 500 // Higher limit since deletions accumulate over time
  });

/**
 * The NIP-09 deletion events of ONE user (any deletable content type).
 * @param {string} userPubkey
 * @returns {import('rxjs').Observable<NostrEvent>}
 */
export const fetchUserDeletions = (userPubkey) => fetchAuthorsDeletions([userPubkey]);
