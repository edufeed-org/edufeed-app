/**
 * Paging timeline loader — the applesauce v6 `createTimelineLoader` API kept
 * alive on top of applesauce v7.
 *
 * v7 rebuilt the upstream timeline loader around explicit time windows
 * (`loader({ since, until })`) and rejects the v6 "next block" calls
 * (`loader()` / `loader(since)`) that every feed, list and detail surface in
 * this app paginates with. The app's pagination model (per-relay `until`
 * cursors, "load more" buttons, `timedPool` capping stuck relays) is built on
 * the block semantics, so the v6 operators are ported here verbatim rather
 * than rewriting ~150 call sites against the window API in the same change as
 * the dependency bump. The port keeps v6's only dependency surface: a request
 * function or pool, `mergeFilters`, `filterDuplicateEvents` and the loaders'
 * cache/upstream helpers — all still exported by v7.
 *
 * Semantics (unchanged from v6):
 * - `loader()` loads the next OLDER block: `until` = (oldest seen) - 1.
 * - `loader(since)` with a number lower than the cursor loads the next block
 *   too; `loader({ since, until })` moves the window explicitly.
 * - The loader completes for good once a block returns nothing or the source
 *   stops making progress. Cache and relays page independently.
 * - Events are deduplicated through `eventStore` (or a private EventMemory).
 *
 * Upstream reference: applesauce-loaders@6.2.0 `dist/loaders/timeline-loader.js`.
 */
import { logger as baseLogger } from 'applesauce-core';
import { EventMemory } from 'applesauce-core/event-store';
import { isFilterEqual, mergeFilters } from 'applesauce-core/helpers/filter';
import { createFilterMap } from 'applesauce-core/helpers/relay-selection';
import { filterDuplicateEvents } from 'applesauce-core/observable';
import { makeCacheRequest } from 'applesauce-loaders/helpers/cache';
import { wrapUpstreamPool } from 'applesauce-loaders/helpers/upstream';
import {
  BehaviorSubject,
  distinctUntilChanged,
  EMPTY,
  filter,
  finalize,
  identity,
  isObservable,
  map,
  merge,
  mergeMap,
  Observable,
  of,
  share,
  switchMap,
  tap
} from 'rxjs';

/**
 * @typedef {import('nostr-tools').Event} NostrEvent
 * @typedef {import('nostr-tools').Filter} Filter
 * @typedef {Omit<Filter, 'since' | 'until'>} TimelessFilter
 * @typedef {{ since?: number, until?: number }} TimelineWindow
 * @typedef {(since?: number | TimelineWindow) => Observable<NostrEvent>} TimelineLoader
 * @typedef {import('applesauce-loaders').CacheRequest} CacheRequest
 * @typedef {import('applesauce-loaders').UpstreamPool} UpstreamPool
 * @typedef {import('applesauce-core').Debugger} Debugger
 * @typedef {{ limit?: number, logger?: Debugger }} CommonTimelineLoaderOptions
 * @typedef {CommonTimelineLoaderOptions & { cache?: CacheRequest, eventStore?: any }} TimelineLoaderOptions
 * @typedef {import('applesauce-core/helpers/relay-selection').OutboxMap} OutboxMap
 * @typedef {import('applesauce-core/helpers/relay-selection').FilterMap} FilterMap
 * @typedef {import('applesauce-core/helpers/pointers').ProfilePointer} ProfilePointer
 * @typedef {TimelessFilter | ((users: ProfilePointer[]) => TimelessFilter | TimelessFilter[])} OutboxFilter
 */

let instanceCounter = 0;
const nextId = () => String(++instanceCounter);

/**
 * Watches for changes in the window and loads blocks of events going backward.
 * NOTE: this operator is stateful.
 * @param {(until?: number) => Observable<NostrEvent>} request
 * @param {CommonTimelineLoaderOptions} [opts]
 * @returns {import('rxjs').OperatorFunction<TimelineWindow, NostrEvent>}
 */
export function loadBackwardBlocks(request, opts) {
  return (source) => {
    const log = opts?.logger?.extend('backward').extend(nextId());
    /** @type {number | undefined} */
    let cursor = undefined;
    let loading = false;
    let complete = false;

    return source.pipe(
      filter(({ since, until }) => {
        // Once complete, prevent further requests
        if (complete) return false;
        // If max is unset, initialize to until
        if (cursor === undefined && until !== undefined && Number.isFinite(until)) cursor = until;
        // Skip loads if since is still in range
        if (
          since === undefined ||
          (Number.isFinite(since) && cursor !== undefined && since <= cursor)
        )
          return false;
        // Don't load blocks in parallel
        if (loading) return false;
        return true;
      }),
      // mergeMap so old requests continue to load
      mergeMap(() => {
        loading = true;
        let count = 0;
        /** @type {number | undefined} */
        let minCreatedAt;
        const until = cursor;
        log?.(`Loading block until:${until}`);

        return request(until).pipe(
          tap((event) => {
            count++;
            minCreatedAt = Math.min(event.created_at, minCreatedAt ?? Infinity);
          }),
          finalize(() => {
            // NIP-01 defines `until` as inclusive. Move past the oldest event in
            // the block so the next request does not repeat the boundary second.
            if (minCreatedAt !== undefined) {
              const next = minCreatedAt - 1;
              // Stop if the relay ignores `until` and stops making backward progress.
              if (until !== undefined && next >= until) complete = true;
              else cursor = next;
            }
            loading = false;
            complete = complete || count === 0;
            log?.(`Found ${count} events`);
            if (complete) log?.('Complete');
          })
        );
      })
    );
  };
}

/**
 * Watches for changes in the window and loads blocks of events going forward.
 * NOTE: this operator is stateful.
 * @param {(since?: number) => Observable<NostrEvent>} request
 * @param {CommonTimelineLoaderOptions} [opts]
 * @returns {import('rxjs').OperatorFunction<TimelineWindow, NostrEvent>}
 */
export function loadForwardBlocks(request, opts) {
  return (source) => {
    const log = opts?.logger?.extend('forward').extend(nextId());
    /** @type {number | undefined} */
    let cursor = undefined;
    let loading = false;
    let complete = false;

    return source.pipe(
      filter(({ since, until }) => {
        if (complete) return false;
        // If min is unset, initialize to since
        if (cursor === undefined && since !== undefined && Number.isFinite(since)) cursor = since;
        // Skip loads if until is still in range
        if (
          until === undefined ||
          (Number.isFinite(until) && cursor !== undefined && until <= cursor)
        )
          return false;
        if (loading) return false;
        return true;
      }),
      mergeMap(() => {
        loading = true;
        let count = 0;
        /** @type {number | undefined} */
        let maxCreatedAt;
        const since = cursor;
        log?.(`Loading block since:${since}`);

        return request(since).pipe(
          tap((event) => {
            count++;
            maxCreatedAt = Math.max(event.created_at, maxCreatedAt ?? -Infinity);
          }),
          finalize(() => {
            if (maxCreatedAt !== undefined) {
              // Stop if the source ignores `since` and stops making forward progress.
              if (since !== undefined && maxCreatedAt <= since) complete = true;
              else cursor = maxCreatedAt;
            }
            loading = false;
            complete = complete || count === 0;
            log?.(`Found ${count} events`);
            if (complete) log?.('Complete');
          })
        );
      })
    );
  };
}

/**
 * Loads blocks of events until none are returned or the since timestamp is reached.
 * @param {(base: Filter) => Observable<NostrEvent>} request
 * @param {CommonTimelineLoaderOptions} [opts]
 * @returns {import('rxjs').OperatorFunction<TimelineWindow, NostrEvent>}
 */
export function loadBlocksForTimelineWindow(request, opts) {
  return (source) =>
    merge(
      source.pipe(loadBackwardBlocks((until) => request({ until }), opts)),
      source.pipe(loadForwardBlocks((since) => request({ since }), opts))
    );
}

/**
 * @param {TimelessFilter[] | TimelessFilter} filters
 * @param {Filter} base
 * @param {CommonTimelineLoaderOptions} [opts]
 * @returns {Filter[]}
 */
function blockFilters(filters, base, opts) {
  const list = Array.isArray(filters) ? filters : [filters];
  return list.map((f) =>
    opts?.limit ? mergeFilters(f, base, { limit: opts.limit }) : mergeFilters(f, base)
  );
}

/**
 * Loads timeline blocks from a cache request.
 * @param {CacheRequest} request
 * @param {TimelessFilter[] | TimelessFilter} filters
 * @param {CommonTimelineLoaderOptions} [opts]
 * @returns {import('rxjs').OperatorFunction<TimelineWindow, NostrEvent>}
 */
export function loadBlocksFromCache(request, filters, opts) {
  const logger = opts?.logger?.extend('cache');
  /** @param {Filter} base */
  const loader = (base) => makeCacheRequest(request, blockFilters(filters, base, opts));
  return (source) => source.pipe(loadBlocksForTimelineWindow(loader, { ...opts, logger }));
}

/**
 * Loads timeline blocks from relays using a pool or request method.
 * @param {UpstreamPool} pool
 * @param {string[]} relays
 * @param {TimelessFilter[] | TimelessFilter} filters
 * @param {CommonTimelineLoaderOptions} [opts]
 * @returns {import('rxjs').OperatorFunction<TimelineWindow, NostrEvent>}
 */
export function loadBlocksFromRelays(pool, relays, filters, opts) {
  const logger = opts?.logger?.extend('relays');
  const request = wrapUpstreamPool(pool);
  /** @param {Filter} base */
  const loader = (base) => request(relays, blockFilters(filters, base, opts));
  return (source) => source.pipe(loadBlocksForTimelineWindow(loader, { ...opts, logger }));
}

/**
 * Loads timeline blocks from a single relay.
 * @param {UpstreamPool} pool
 * @param {string} relay
 * @param {TimelessFilter[] | TimelessFilter} filters
 * @param {CommonTimelineLoaderOptions} [opts]
 * @returns {import('rxjs').OperatorFunction<TimelineWindow, NostrEvent>}
 */
export function loadBlocksFromRelay(pool, relay, filters, opts) {
  const logger = opts?.logger?.extend(relay);
  const request = wrapUpstreamPool(pool);
  /** @param {Filter} base */
  const loader = (base) => request([relay], blockFilters(filters, base, opts));
  return (source) => source.pipe(loadBlocksForTimelineWindow(loader, { ...opts, logger }));
}

/**
 * Loads timeline blocks from a map of relays to filters.
 * @param {UpstreamPool} pool
 * @param {FilterMap | Observable<FilterMap>} relayMap
 * @param {CommonTimelineLoaderOptions} [opts]
 * @returns {import('rxjs').OperatorFunction<TimelineWindow, NostrEvent>}
 */
export function loadBlocksFromFilterMap(pool, relayMap, opts) {
  return (source) => {
    const map$ = isObservable(relayMap) ? relayMap : of(relayMap);
    /** @type {Map<string, { filters: any, loader: Observable<NostrEvent> }>} */
    const cache = new Map();

    const loaders$ = map$.pipe(
      map((relayMap) =>
        Object.entries(relayMap).map(([relay, filters]) => {
          const existing = cache.get(relay);
          if (existing && isFilterEqual(existing.filters, filters)) return existing.loader;
          // Create a new loader for this relay + filter set
          const loader = source.pipe(loadBlocksFromRelay(pool, relay, filters, opts));
          cache.set(relay, { filters, loader });
          return loader;
        })
      )
    );

    return loaders$.pipe(switchMap((loaders) => merge(...loaders)));
  };
}

/**
 * Loads timeline blocks from an outbox map and a filter (or a function
 * projecting users to filters).
 * @param {UpstreamPool} pool
 * @param {OutboxMap | Observable<OutboxMap>} outboxes
 * @param {OutboxFilter} filter
 * @param {CommonTimelineLoaderOptions} [opts]
 * @returns {import('rxjs').OperatorFunction<TimelineWindow, NostrEvent>}
 */
export function loadBlocksFromOutboxMap(pool, outboxes, filter, opts) {
  const outboxes$ = isObservable(outboxes) ? outboxes : of(outboxes);

  const filterMap$ = outboxes$.pipe(
    map((outboxes) => {
      if (typeof filter === 'function')
        return Object.fromEntries(
          Object.entries(outboxes).map(([relay, users]) => [relay, filter(users)])
        );
      return createFilterMap(outboxes, filter);
    })
  );

  return loadBlocksFromFilterMap(pool, /** @type {Observable<FilterMap>} */ (filterMap$), opts);
}

/**
 * Loads timeline blocks from a cache request for every user of an outbox map.
 * @param {CacheRequest} cache
 * @param {OutboxMap | Observable<OutboxMap>} outboxes
 * @param {OutboxFilter} filter
 * @param {CommonTimelineLoaderOptions} [opts]
 * @returns {import('rxjs').OperatorFunction<TimelineWindow, NostrEvent>}
 */
export function loadBlocksFromOutboxMapCache(cache, outboxes, filter, opts) {
  const outboxes$ = isObservable(outboxes) ? outboxes : of(outboxes);

  const filters$ = outboxes$.pipe(
    map((outboxes) => {
      /** @type {Set<string>} */
      const pubkeys = new Set();
      for (const users of Object.values(outboxes)) {
        for (const user of users) pubkeys.add(user.pubkey);
      }
      if (typeof filter === 'function') {
        const users = Array.from(pubkeys).map((pubkey) => ({ pubkey }));
        return filter(users);
      }
      return mergeFilters(filter, { authors: Array.from(pubkeys) });
    }),
    // Only create a new loader if the filters change
    distinctUntilChanged((a, b) => isFilterEqual(a, b))
  );

  return (source) =>
    filters$.pipe(
      // Every time the filters change, create a new cache loader instance
      switchMap((filters) => source.pipe(loadBlocksFromCache(cache, filters, opts)))
    );
}

/**
 * Internal logic for function based timeline loaders.
 * @param {BehaviorSubject<TimelineWindow>} window$
 * @param {Observable<NostrEvent>} loader$
 * @param {any} [eventStore]
 * @returns {TimelineLoader}
 */
function wrapTimelineLoader(window$, loader$, eventStore) {
  const singleton$ = loader$.pipe(
    // Pass all events through the store if provided (null disables dedup)
    eventStore === null ? identity : filterDuplicateEvents(eventStore || new EventMemory()),
    // Ensure a single subscription to the requests
    share()
  );

  return (since) =>
    new Observable((observer) => {
      const sub = singleton$.subscribe(observer);
      // Only update the window once this request is subscribed to (prevents
      // the window update getting lost before subscription)
      if (typeof since === 'object' && since !== undefined) {
        window$.next(since);
      } else {
        // Default to -Infinity to force loading the next block of events
        window$.next({ since: since ?? -Infinity });
      }
      return () => sub.unsubscribe();
    });
}

/**
 * Creates a paging timeline loader that loads blocks of events from multiple
 * relays and an optional cache.
 * @param {UpstreamPool} pool
 * @param {string[]} relays
 * @param {TimelessFilter[] | TimelessFilter} filters
 * @param {TimelineLoaderOptions} [opts]
 * @returns {TimelineLoader}
 */
export function createTimelineLoader(pool, relays, filters, opts) {
  const logger = (opts?.logger ?? baseLogger).extend('timeline').extend(nextId());
  /** @type {BehaviorSubject<TimelineWindow>} */
  const window$ = new BehaviorSubject({});

  const cache$ = opts?.cache
    ? window$.pipe(loadBlocksFromCache(opts.cache, filters, { ...opts, logger }))
    : EMPTY;
  const relays$ = window$.pipe(loadBlocksFromRelays(pool, relays, filters, { ...opts, logger }));

  return wrapTimelineLoader(window$, merge(cache$, relays$), opts?.eventStore);
}

/**
 * Creates a paging timeline loader for an outbox map (or an observable of one).
 * @param {UpstreamPool} pool
 * @param {OutboxMap | Observable<OutboxMap>} outboxes
 * @param {OutboxFilter} filter
 * @param {TimelineLoaderOptions} [opts]
 * @returns {TimelineLoader}
 */
export function createOutboxTimelineLoader(pool, outboxes, filter, opts) {
  const logger = (opts?.logger ?? baseLogger).extend('outbox-timeline').extend(nextId());
  /** @type {BehaviorSubject<TimelineWindow>} */
  const window$ = new BehaviorSubject({});

  const cache$ = opts?.cache
    ? window$.pipe(loadBlocksFromOutboxMapCache(opts.cache, outboxes, filter, { ...opts, logger }))
    : EMPTY;
  const relays$ = window$.pipe(
    loadBlocksFromOutboxMap(pool, outboxes, filter, { ...opts, logger })
  );

  return wrapTimelineLoader(window$, merge(cache$, relays$), opts?.eventStore);
}
