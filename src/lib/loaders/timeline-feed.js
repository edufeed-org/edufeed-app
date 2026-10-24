/**
 * createTimelineFeed — one applesauce v7 window loader per scrolling surface.
 *
 * v7's timeline loader follows a finite `{ since, until }` window and fills it
 * independently from every relay, with per-relay coverage, retry/backoff and
 * a prefetch buffer below the window. This module turns that into the
 * count-based "load more" the app's feeds have always had:
 *
 * - The window starts ZERO-WIDTH at `until = now`. Covering one second costs
 *   one trivial REQ per relay; the SDK's prefetch (`prefetch: pageSize`) then
 *   keeps `pageSize` events buffered below the window per relay regardless of
 *   how dense the relay is — a time-based initial span would page a busy relay
 *   sequentially before anything could be shown.
 * - `loadMore()` moves `since` down to the `pageSize`-th buffered older event
 *   SEEN ON THIS FEED'S RELAYS (the k-th newest of the union is never older
 *   than the k-th newest of any relay's own buffer, so the widened window is
 *   already covered everywhere and the next page prefetches in the
 *   background). The shared EventStore also holds same-kind events from other
 *   surfaces and the IDB cache; counting those would move the window by a few
 *   seconds and leave the relay's buffer untouched — the dashboard relay feed
 *   would click "load more" with nothing appearing. With the buffer still
 *   filling it waits (`pending`); with every relay paged to the beginning
 *   there is nothing left (`exhausted`).
 * - Relays and the filter are reactive (`sync()`): `loadBlocksFromFilterMap`
 *   reconciles per relay, so a relay added later (kind 30002 overrides) is
 *   loaded for the current window without re-requesting the others, and a
 *   grown `authors` list requests only the added authors.
 * - Requests go to the pool directly, NOT through `timedPool`: v7 commits
 *   coverage only when a page completes and retries when it errors, and
 *   `timedPool` turns every failure into an empty completed page (a dead relay
 *   would be "exhausted" for the session). A relay that sends events but never
 *   EOSE is cut `hangTimeout` after its last event and its page committed;
 *   connection failures and the group's first-response timeout stay errors.
 *
 * - A live leg (`live`, default on) keeps a `pool.subscription` open on the feed
 *   relays for events newer than the window; they land in the EventStore and
 *   show up through the models at once (store first), counted in `newCount`.
 *   `catchUp()` moves `until` to now so the SDK fetches whatever the
 *   subscription missed (a dropped connection, a relay that reconnected); it
 *   runs on every `visible$` signal — by default when the tab becomes visible
 *   again.
 *
 * `status$` is for spinners and "no more" only — models render whatever the
 * EventStore already holds (CLAUDE.md "Store first").
 *
 * Upstream note: the SDK's `createTimelineLoader` takes a static relay list;
 * this module restates its ~20-line status bookkeeping around
 * `loadBlocksFromFilterMap` to get an observable relay set. An
 * `Observable<string[]>` relays argument upstream would delete that block.
 */
import { logger as baseLogger } from 'applesauce-core';
import { isFilterEqual } from 'applesauce-core/helpers/filter';
import { getSeenRelays } from 'applesauce-core/helpers/relays';
import { normalizeURL } from 'applesauce-core/helpers/url';
import { unixNow } from 'applesauce-core/helpers/time';
import { mapEventsToStore } from 'applesauce-core/observable';
import { loadBlocksFromFilterMap } from 'applesauce-loaders/loaders';
import { makeCacheRequest } from 'applesauce-loaders/helpers/cache';
import { RelayGroup } from 'applesauce-relay';
import {
  BehaviorSubject,
  combineLatest,
  defer,
  distinct,
  EMPTY,
  filter as rxFilter,
  finalize,
  fromEvent,
  ignoreElements,
  map,
  merge,
  Observable,
  retry,
  share,
  switchMap,
  tap
} from 'rxjs';
import { pool, eventStore as sharedEventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { cacheRequest } from '$lib/stores/event-cache.svelte.js';

/**
 * @typedef {import('nostr-tools').Event} NostrEvent
 * @typedef {import('nostr-tools').Filter} Filter
 * @typedef {import('applesauce-loaders').TimelessFilter} TimelessFilter
 * @typedef {import('applesauce-loaders/loaders').TimelineStatus} TimelineStatus
 * @typedef {import('applesauce-loaders/loaders').TimelineWindow} TimelineWindow
 *
 * @typedef {object} TimelineFeedOptions
 * @property {() => string[]} getRelays - Re-read on every `sync()`
 * @property {() => TimelessFilter} getFilter - Re-read on every `sync()`
 * @property {number} [pageSize=20] - Events one `loadMore()` adds; the prefetch depth per relay
 * @property {number} [limit=50] - Events per REQ
 * @property {number} [cacheWarmLimit=100] - Events replayed from the IDB cache on start; 0 disables
 * @property {number} [hangTimeout=10000] - ms of silence after a relay's first event before its page is cut
 * @property {(relays: string[], filters: Filter[]) => Observable<NostrEvent>} [request] - Defaults to the shared pool
 * @property {import('applesauce-core').EventStore} [eventStore] - Defaults to the shared store
 * @property {import('applesauce-loaders').CacheRequest | null} [cache] - Defaults to the IDB cache; null = no warm
 * @property {boolean} [live=true] - Keep a subscription open for events newer than the window
 * @property {(relays$: Observable<string[]>, filters: Filter[]) => Observable<NostrEvent>} [subscribe] - Live source; defaults to `pool.subscription`
 * @property {Observable<unknown>} [visible$] - Each emission runs `catchUp()`; defaults to the tab becoming visible
 *
 * @typedef {object} TimelineFeedStatus
 * @property {boolean} pending - `loadMore()` asked for a page the buffer does not hold yet
 * @property {boolean} settled - Every relay is `covered` or `incomplete` (nothing loading or prefetching)
 * @property {boolean} exhausted - Every relay is `incomplete` or covered to 0 (or there are no relays)
 * @property {boolean} failing - Some relay is `incomplete`: its last request failed and the SDK retries it after a backoff
 * @property {number} newCount - Events the live leg delivered that are newer than the window (reset by `catchUp()`)
 * @property {number} since
 * @property {number} until
 * @property {TimelineStatus[]} relays - The SDK's per-relay (and per author group) coverage
 *
 * @typedef {object} TimelineFeed
 * @property {Observable<NostrEvent>} events$ - Subscribing starts the loader (and the cache warm); unsubscribing stops it
 * @property {Observable<TimelineFeedStatus>} status$ - Replays the latest status
 * @property {() => TimelineFeedStatus} getStatus
 * @property {() => void} loadMore
 * @property {() => void} sync
 * @property {() => void} catchUp - Extend the window to now so the SDK fills whatever the live leg missed
 */

/**
 * Completes `ms` after the last emission. Armed by the FIRST emission only: a
 * source that never emits is left alone (the relay group's own first-response
 * timeout owns that case and must surface as an error, not as an empty page).
 * Errors and natural completion pass through.
 *
 * @template T
 * @param {number} ms
 * @returns {import('rxjs').MonoTypeOperatorFunction<T>}
 */
export function completeAfterSilence(ms) {
  return (source) =>
    new Observable((subscriber) => {
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let timer;
      const arm = () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => subscriber.complete(), ms);
      };
      const sub = source.subscribe({
        next: (value) => {
          subscriber.next(value);
          arm();
        },
        error: (err) => subscriber.error(err),
        complete: () => subscriber.complete()
      });
      return () => {
        if (timer !== undefined) clearTimeout(timer);
        sub.unsubscribe();
      };
    });
}

/**
 * One REQ per relay, completing at that relay's EOSE (the loader asks relays
 * one at a time, so "all EOSE" is this relay's).
 * @type {(relays: string[], filters: Filter[]) => Observable<NostrEvent>}
 */
const poolRequest = (relays, filters) =>
  pool.request(relays, filters, { complete: RelayGroup.completeOnAllEose() });

/**
 * Live source: one standing REQ per relay; the pool follows the relay list.
 * @type {(relays$: Observable<string[]>, filters: Filter[]) => Observable<NostrEvent>}
 */
const poolSubscribe = (relays$, filters) => pool.subscription(relays$, filters);

/** The tab becoming visible again (nothing on the server). */
const defaultVisible$ = () =>
  typeof document === 'undefined'
    ? EMPTY
    : fromEvent(document, 'visibilitychange').pipe(
        rxFilter(() => document.visibilityState === 'visible')
      );

/** @param {string[]} a @param {string[]} b */
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** @param {TimelineStatus} s */
const isSettled = (s) => s.state === 'covered' || s.state === 'incomplete';
/** @param {TimelineStatus} s */
const isCoveredToZero = (s) => s.state === 'covered' && s.buffer.since === 0;
/** @param {TimelineStatus} s */
const isDone = (s) => s.state === 'incomplete' || isCoveredToZero(s);

/**
 * @param {TimelineFeedOptions} options
 * @returns {TimelineFeed}
 */
export function createTimelineFeed(options) {
  const {
    getRelays,
    getFilter,
    pageSize = 20,
    limit = 50,
    cacheWarmLimit = 100,
    hangTimeout = 10_000,
    request = poolRequest,
    eventStore = sharedEventStore,
    cache = cacheRequest,
    live = true,
    subscribe = poolSubscribe,
    visible$ = defaultVisible$()
  } = options;
  const log = baseLogger.extend('timeline-feed');

  /** @type {BehaviorSubject<TimelineWindow>} */
  const window$ = new BehaviorSubject({ since: unixNow(), until: unixNow() });
  /** created_at of every event the live leg delivered, by id */
  const liveSeen = new Map();
  const relays$ = new BehaviorSubject(getRelays());
  const filter$ = new BehaviorSubject(getFilter());

  /** @type {TimelineStatus[]} */
  let relayStatuses = [];
  let pending = false;
  let active = false;
  let retryQueued = false;

  /** @returns {TimelineFeedStatus} */
  function compute() {
    const relays = relays$.value;
    const current = relayStatuses.filter((s) => relays.includes(s.source));
    const reported = relays.every((relay) => current.some((s) => s.source === relay));
    const none = relays.length === 0;
    const { since, until } = window$.value;
    let newCount = 0;
    for (const createdAt of liveSeen.values()) if (createdAt > until) newCount++;
    return {
      pending,
      settled: none || (reported && current.every(isSettled)),
      exhausted: none || (reported && current.every(isDone)),
      failing: current.some((s) => s.state === 'incomplete'),
      newCount,
      since,
      until,
      relays: current
    };
  }

  const status$ = new BehaviorSubject(compute());

  function publish() {
    const next = compute();
    status$.next(next);
    // A page the buffer could not serve: retry once the relays have settled.
    // Deferred so a window change never re-enters the loader from its own
    // status callback, and queued once: one settle can arrive as a burst of
    // statuses (one per relay and author group), and a second retry after the
    // first moved the window would page twice.
    if (pending && next.settled && !retryQueued) {
      retryQueued = true;
      queueMicrotask(() => {
        retryQueued = false;
        if (pending) loadMore();
      });
    }
  }

  /** @param {TimelineStatus} next */
  function onStatus(next) {
    const i = relayStatuses.findIndex(
      (s) => s.source === next.source && isFilterEqual(s.filter, next.filter)
    );
    if (next.state === 'removed') {
      if (i >= 0) relayStatuses.splice(i, 1);
    } else if (i < 0) relayStatuses.push(next);
    else relayStatuses[i] = next;
    relayStatuses = [...relayStatuses];
    publish();
  }

  /**
   * Events older than the window that one of THIS feed's relays delivered, newest first.
   * @param {number} since
   */
  function bufferedBelow(since) {
    const relays = new Set(relays$.value.map((r) => normalizeURL(r)));
    return eventStore.getTimeline({ ...filter$.value, until: since - 1 }).filter((event) => {
      const seen = getSeenRelays(event);
      if (!seen) return false;
      for (const relay of seen) if (relays.has(relay)) return true;
      return false;
    });
  }

  function loadMore() {
    if (!active) return;
    const { since, until } = window$.value;
    if (since === 0) {
      pending = false;
      publish();
      return;
    }
    const current = compute();
    const older = bufferedBelow(since);
    if (older.length >= pageSize) {
      pending = false;
      window$.next({ since: older[pageSize - 1].created_at, until });
    } else if (!current.settled) {
      pending = true;
    } else {
      pending = false;
      if (older.length > 0) {
        // Take what the relays had
        window$.next({ since: older[older.length - 1].created_at, until });
      } else if (current.relays.length > 0 && current.relays.every(isCoveredToZero)) {
        // Every relay is paged to the beginning: nothing is left anywhere
        window$.next({ since: 0, until });
      }
      // Otherwise a relay is failing (backoff) or the store disagrees with the
      // relays: keep the window — closing it to 0 would make a recovering
      // relay crawl its whole history as visible gaps.
    }
    publish();
  }

  function catchUp() {
    if (!active) return;
    const now = unixNow();
    const { since, until } = window$.value;
    if (now <= until) return;
    // The SDK treats the extension as a visible gap and requests
    // { since: until + 1, until: now } from every relay.
    window$.next({ since, until: now });
    publish();
  }

  function sync() {
    const relays = getRelays();
    if (!sameList(relays, relays$.value)) relays$.next(relays);
    const filter = getFilter();
    if (!isFilterEqual(filter, filter$.value)) filter$.next(filter);
    publish();
  }

  const filterMap$ = combineLatest([relays$, filter$]).pipe(
    map(([relays, filter]) => Object.fromEntries(relays.map((relay) => [relay, [filter]])))
  );

  /** @type {(relays: string[], filters: Filter[]) => Observable<NostrEvent>} */
  const cutRequest = (relays, filters) =>
    request(relays, filters).pipe(completeAfterSilence(hangTimeout));

  const events$ = defer(() => {
    active = true;
    relayStatuses = [];
    pending = false;
    const warm$ =
      cache && cacheWarmLimit > 0
        ? defer(() => makeCacheRequest(cache, [{ ...filter$.value, limit: cacheWarmLimit }]))
        : EMPTY;
    const loader$ = window$.pipe(
      loadBlocksFromFilterMap(cutRequest, filterMap$, {
        limit,
        prefetch: pageSize,
        logger: log,
        onStatus
      })
    );
    // Events newer than the window, for as long as the feed is displayed.
    // Resubscribed when the filter changes; the pool follows relays$ itself.
    const live$ = !live
      ? EMPTY
      : filter$.pipe(
          switchMap((filter) =>
            subscribe(relays$.asObservable(), [{ ...filter, since: window$.value.until + 1 }]).pipe(
              retry({ delay: 60_000 })
            )
          ),
          tap((event) => {
            liveSeen.set(event.id, event.created_at);
            publish();
          })
        );
    const catchUp$ = visible$.pipe(
      tap(() => catchUp()),
      ignoreElements()
    );
    return merge(warm$, loader$, live$, catchUp$).pipe(
      // Store every arrival before deduplicating output, preserving relay metadata.
      mapEventsToStore(eventStore, false),
      distinct((event) => event.id),
      finalize(() => {
        active = false;
        pending = false;
        relayStatuses = [];
        liveSeen.clear();
        publish();
      })
    );
  }).pipe(share());

  return {
    events$,
    status$: status$.asObservable(),
    getStatus: () => status$.value,
    loadMore,
    sync,
    catchUp
  };
}
