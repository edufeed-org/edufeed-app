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
import {
  skipParkedRelays,
  relayLiveness,
  watchConnectDeadline
} from '$lib/stores/relay-liveness.js';
import { EMPTY, defer, from, isObservable, merge, mergeAll, mergeMap, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { createAddressLoader, createEventLoader } from 'applesauce-loaders/loaders';
import { isEventPointer } from 'applesauce-core/helpers/pointers';
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
  pool
    // Relays the liveness tracker has parked (recent connection failures) are
    // left out so one dead relay does not hold this one-shot for the full cap;
    // never all of them — see skipParkedRelays.
    .request(skipParkedRelays(relayLiveness, relays), filters, { timeout: 10_000 })
    .pipe(catchError(() => EMPTY));

/**
 * Upstream request of the event/address loaders below. A loader stage asks
 * its relays together and moves on only when the stage completes or after
 * LOADER_STAGE_TIMEOUT_MS, so one relay that never answers held every miss
 * for the full stage (5.2 s measured with a dead relay in the lookup list —
 * on the path of every quote/reference not on the lookup relays).
 *
 * Lookups BY ID (every filter only `ids`) leave out the relays the liveness
 * tracker has parked, and arm its connect deadline for the relays they ask
 * (a relay that hangs at connect is otherwise never parked): nobody draws a conclusion from such a miss beyond
 * "show a badge, retry later". Everything else — replaceables, profiles,
 * kind 10002/10050, whose confirmed "absent" verdict write paths act on —
 * keeps every relay (see the "Pool liveness" rule in CLAUDE.md).
 *
 * @param {string[]} relays
 * @param {Filter[]} filters
 */
export const loaderRequest = (relays, filters) => {
  const byId = filters.every((f) => Object.keys(f).every((key) => key === 'ids'));
  if (!byId) return pool.request(relays, filters);
  const eligible = skipParkedRelays(relayLiveness, relays);
  // skipParkedRelays never empties a list, but the event loader asks each
  // hint relay in a request of its own: a parked hint relay comes alone. Skip
  // it while other relays are online (the network works, that relay does
  // not); with nothing online, asking it beats asking nobody.
  if (eligible.every((relay) => isParked(relay)) && relayLiveness.online?.length > 0) {
    return EMPTY;
  }
  // A relay that swallows the connection never errors, so nothing would ever
  // park it: count "not open 15 s after we asked" as a failure.
  for (const url of eligible) watchConnectDeadline(relayLiveness, pool.relay(url));
  return pool.request(eligible, filters);
};

/** @param {string} relay */
const isParked = (relay) => relayLiveness.filter([relay]).length === 0;

/** Batches the address/event loaders run at once (applesauce default 4). */
export const LOADER_CONCURRENT_BATCHES = 16;
/** Budget per loader stage before unresolved pointers move to the next stage (applesauce default 10 s). */
export const LOADER_STAGE_TIMEOUT_MS = 5_000;

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

// The event loaders' last stage: the content lookup relays, asked for the ids
// that the cache and the pointer's own relay hints did not resolve (relays a
// hint already covered are skipped). Without it an event pointer with no
// hints — a `note1…`, a bare id, `eventStore.event(id)` — asked no relay at
// all and only ever resolved from the IDB cache. Indexers are left out: they
// carry profiles and relay lists, not notes. Same live-config `defer` as above.
const eventLookupRelays$ = defer(() => of(getAllLookupRelays()));

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
export const addressLoader = createAddressLoader(loaderRequest, {
  eventStore,
  cacheRequest: revalidatingCacheRequest,
  lookupRelays: lookupRelays$,
  // A stage that does not answer must not hold everything else: the batch
  // engine runs at most `maxConcurrentBatches` lookups at once and each stage
  // (cache → relay hints → lookup relays) gets `stageTimeout` before its
  // unresolved pointers move on. With the defaults (4 batches, 10 s per stage)
  // one stalled IndexedDB cache turned every profile/address lookup in the
  // app into a 10 s wait and queued the rest behind it (inline previews
  // appeared 15–20 s after mount). The cache read is additionally bounded in
  // event-cache.svelte.js.
  maxConcurrentBatches: LOADER_CONCURRENT_BATCHES,
  stageTimeout: LOADER_STAGE_TIMEOUT_MS
});

// Standalone event-by-ID loader for direct use.
// bufferTime: 0 dispatches the relay request on the next microtask instead of
// waiting the default 1s — same-tick calls still batch, but a single detail-page
// fetch no longer burns a full second of its timeout budget before connecting.
export const eventLoader = createEventLoader(loaderRequest, {
  eventStore,
  cacheRequest,
  extraRelays: eventLookupRelays$,
  bufferTime: 0,
  maxConcurrentBatches: LOADER_CONCURRENT_BATCHES,
  stageTimeout: LOADER_STAGE_TIMEOUT_MS
});

// EventStore fallback loader (`eventStore.event()` / `.replaceable()` /
// `.profile()` on a miss): routes to the two shared loaders above instead of
// building a second pair with `createUnifiedEventLoader`. One batch queue and
// one in-flight map per pointer type, so a store fallback and an explicit
// `eventLoader(...)` / `addressLoader(...)` for the same pointer share a
// request. It also keeps `extraRelays` off the address side, where it would
// run as its own stage BEFORE the lookup relays and make every profile found
// only on an indexer wait out a hanging content relay first.
const unifiedLoader = Object.assign(
  (/** @type {any} */ pointer) =>
    isEventPointer(pointer) ? eventLoader(pointer) : addressLoader(pointer),
  (() => {
    const stop = () => {
      eventLoader.stop();
      addressLoader.stop();
    };
    return { stop, [Symbol.dispose]: stop };
  })()
);
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
