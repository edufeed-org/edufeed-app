/** @vitest-environment node */
// createTimelineFeed: one applesauce v7 window loader per scrolling surface.
// A fake relay serves NIP-01 semantics (since/until/limit, newest first) so
// the tests pin what the feed asks for and what it reports, not the SDK.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventStore } from 'applesauce-core';
import { concat, NEVER, of, Subject, throwError } from 'rxjs';

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { request: vi.fn() },
  eventStore: new EventStore({ verifyEvent: () => true })
}));
vi.mock('$lib/stores/event-cache.svelte.js', () => ({
  cacheRequest: vi.fn(async () => [])
}));

const { createTimelineFeed, completeAfterSilence } = await import('$lib/loaders/timeline-feed.js');

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const RA = 'wss://a.example/';
const RB = 'wss://b.example/';

/** @param {number} createdAt @param {string} id @param {string} [pubkey] */
const ev = (createdAt, id, pubkey = A) => ({
  id,
  kind: 1,
  pubkey,
  created_at: createdAt,
  content: '',
  tags: [],
  sig: 's'.repeat(128)
});

/**
 * `count` events for one relay, newest at `now - gap`, one every `step` s.
 * @param {string} tag @param {number} count @param {{ now: number, gap?: number, step?: number, pubkey?: string }} o
 */
function series(tag, count, { now, gap = 60, step = 60, pubkey = A }) {
  return Array.from({ length: count }, (_, i) => ev(now - gap - i * step, `${tag}-${i}`, pubkey));
}

/**
 * A fake pool: per-relay event lists served like a NIP-01 relay.
 * @param {Record<string, any[]>} data
 * @param {(relay: string, filter: any, events: any[]) => import('rxjs').Observable<any> | undefined} [override]
 */
function fakeRelays(data, override) {
  /** @type {{ relay: string, filter: any }[]} */
  const calls = [];
  const request = vi.fn((/** @type {string[]} */ relays, /** @type {any[]} */ filters) => {
    const relay = relays[0];
    const filter = filters[0];
    calls.push({ relay, filter });
    const events = (data[relay] ?? [])
      .filter(
        (e) =>
          (filter.since === undefined || e.created_at >= filter.since) &&
          (filter.until === undefined || e.created_at <= filter.until) &&
          (!filter.authors || filter.authors.includes(e.pubkey))
      )
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, filter.limit ?? Infinity);
    return override?.(relay, filter, events) ?? of(...events);
  });
  return {
    request,
    calls,
    callsFor: (/** @type {string} */ r) => calls.filter((c) => c.relay === r)
  };
}

/** Let the loader's asap-scheduled batches and the fake relays settle. */
async function flush(rounds = 6) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 2));
}

/** @param {Partial<Parameters<typeof createTimelineFeed>[0]> & { request: any }} o */
function makeFeed(o) {
  const eventStore = new EventStore({ verifyEvent: () => true });
  const relays = o.getRelays ? undefined : [RA, RB];
  const feed = createTimelineFeed({
    getRelays: () => /** @type {string[]} */ (relays),
    getFilter: () => ({ kinds: [1] }),
    pageSize: 20,
    limit: 50,
    eventStore,
    cache: null,
    ...o
  });
  return { feed, eventStore };
}

const now = () => Math.floor(Date.now() / 1000);

describe('createTimelineFeed', () => {
  afterEach(() => vi.useRealTimers());

  it('starts with a zero-width window; the SDK fills it and the prefetch buffer in one page per relay', async () => {
    const t = now();
    const { request, callsFor } = fakeRelays({
      [RA]: series('a', 100, { now: t }),
      [RB]: series('b', 100, { now: t, gap: 90 })
    });
    const { feed, eventStore } = makeFeed({ request });
    const sub = feed.events$.subscribe();
    await flush();
    const { until } = feed.getStatus();

    // The visible window is [until, until]; v7 lets the first request fill a
    // whole batch below it, so one REQ covers the window and the buffer.
    for (const relay of [RA, RB]) {
      const calls = callsFor(relay).map((c) => c.filter);
      expect(calls).toEqual([{ kinds: [1], until, limit: 50 }]);
    }
    expect(feed.getStatus().since).toBe(until);
    expect(eventStore.getTimeline({ kinds: [1] })).toHaveLength(100);
    sub.unsubscribe();
  });

  it('prefetch stops once pageSize older events are buffered per relay', async () => {
    const t = now();
    const { request, callsFor } = fakeRelays({
      [RA]: series('a', 100, { now: t }),
      [RB]: series('b', 100, { now: t, gap: 90 })
    });
    const { feed } = makeFeed({ request });
    const sub = feed.events$.subscribe();
    await flush();
    expect(callsFor(RA)).toHaveLength(1);
    expect(callsFor(RB)).toHaveLength(1);
    const s = feed.getStatus();
    expect(s.settled).toBe(true);
    expect(s.exhausted).toBe(false);
    expect(s.pending).toBe(false);
    sub.unsubscribe();
  });

  it('loadMore() with a full buffer moves since to the pageSize-th older event without a new request, and prefetches again once the buffer thins', async () => {
    const t = now();
    const a = series('a', 100, { now: t });
    const b = series('b', 100, { now: t, gap: 90 });
    const { request, calls, callsFor } = fakeRelays({ [RA]: a, [RB]: b });
    const { feed, eventStore } = makeFeed({ request });
    const sub = feed.events$.subscribe();
    await flush();
    const before = calls.length;
    const { since: oldSince } = feed.getStatus();

    feed.loadMore();
    await flush();
    const older = eventStore.getTimeline({ kinds: [1], until: oldSince - 1 });
    expect(feed.getStatus().since).toBe(older[19].created_at);
    expect(feed.getStatus().pending).toBe(false);
    expect(calls.length).toBe(before); // both relays already buffered past the new window

    // Keep paging until a relay has fewer than pageSize buffered below the window
    for (let i = 0; i < 3; i++) {
      feed.loadMore();
      await flush();
    }
    const nextA = callsFor(RA)[1]?.filter;
    const nextB = callsFor(RB)[1]?.filter;
    expect(nextA).toEqual({ kinds: [1], until: a[49].created_at, limit: 50 });
    expect(nextB).toEqual({ kinds: [1], until: b[49].created_at, limit: 50 });
    // The second page starts at the (already known) boundary second: 49 new per relay.
    expect(eventStore.getTimeline({ kinds: [1] })).toHaveLength(198);
    sub.unsubscribe();
  });

  it('loadMore() while a prefetch is in flight sets pending and applies once it settles', async () => {
    const t = now();
    const held = new Subject();
    const { request } = fakeRelays({ [RA]: series('a', 100, { now: t }) }, (relay, filter) =>
      filter.since === undefined ? held : undefined
    );
    const { feed } = makeFeed({ request, getRelays: () => [RA] });
    const sub = feed.events$.subscribe();
    await flush();
    expect(feed.getStatus().settled).toBe(false);

    feed.loadMore();
    expect(feed.getStatus().pending).toBe(true);
    const sinceBefore = feed.getStatus().since;

    for (const e of series('a', 50, { now: t })) held.next(e);
    held.complete();
    await flush();
    expect(feed.getStatus().pending).toBe(false);
    expect(feed.getStatus().since).toBeLessThan(sinceBefore);
    sub.unsubscribe();
  });

  it('a relay with nothing older is done, but exhausted stays false while another relay has pages', async () => {
    const t = now();
    const { request } = fakeRelays({
      [RA]: series('a', 5, { now: t }),
      [RB]: series('b', 200, { now: t, gap: 90 })
    });
    const { feed } = makeFeed({ request });
    const sub = feed.events$.subscribe();
    await flush(10);
    const s = feed.getStatus();
    expect(s.exhausted).toBe(false);
    expect(s.settled).toBe(true);
    const a = s.relays.find((r) => r.source === RA);
    expect(a?.state).toBe('covered');
    expect(a?.buffer.since).toBe(0);
    sub.unsubscribe();
  });

  it('exhausted once every relay is covered to 0; loadMore() is then a no-op', async () => {
    const t = now();
    const { request, calls } = fakeRelays({
      [RA]: series('a', 5, { now: t }),
      [RB]: series('b', 5, { now: t, gap: 90 })
    });
    const { feed } = makeFeed({ request });
    const sub = feed.events$.subscribe();
    await flush(10);
    expect(feed.getStatus().exhausted).toBe(true);
    feed.loadMore();
    await flush();
    const n = calls.length;
    feed.loadMore();
    await flush();
    expect(calls.length).toBe(n);
    expect(feed.getStatus().pending).toBe(false);
    sub.unsubscribe();
  });

  it('sync() with a new relay requests only that relay for the current window', async () => {
    const t = now();
    let relays = [RA];
    const { request, calls, callsFor } = fakeRelays({
      [RA]: series('a', 100, { now: t }),
      [RB]: series('b', 100, { now: t, gap: 90 })
    });
    const { feed } = makeFeed({ request, getRelays: () => relays });
    const sub = feed.events$.subscribe();
    await flush();
    const before = callsFor(RA).length;

    relays = [RA, RB];
    feed.sync();
    await flush();
    expect(callsFor(RA)).toHaveLength(before);
    expect(callsFor(RB).length).toBeGreaterThan(0);
    expect(calls.every((c) => c.relay === RA || c.relay === RB)).toBe(true);
    sub.unsubscribe();
  });

  it('sync() is idempotent', async () => {
    const t = now();
    const { request, calls } = fakeRelays({
      [RA]: series('a', 100, { now: t }),
      [RB]: series('b', 100, { now: t, gap: 90 })
    });
    const { feed } = makeFeed({ request });
    const sub = feed.events$.subscribe();
    await flush();
    const n = calls.length;
    feed.sync();
    feed.sync();
    await flush();
    expect(calls.length).toBe(n);
    sub.unsubscribe();
  });

  it('sync() with grown authors requests only the added authors', async () => {
    const t = now();
    let authors = [A];
    const data = {
      [RA]: [
        ...series('a', 60, { now: t, pubkey: A }),
        ...series('ab', 60, { now: t, gap: 30, pubkey: B })
      ]
    };
    const { request, calls } = fakeRelays(data);
    const { feed } = makeFeed({
      request,
      getRelays: () => [RA],
      getFilter: () => ({ kinds: [1], authors })
    });
    const sub = feed.events$.subscribe();
    await flush();
    const before = calls.length;

    authors = [A, B];
    feed.sync();
    await flush();
    const added = calls.slice(before);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((c) => c.filter.authors.length === 1 && c.filter.authors[0] === B)).toBe(
      true
    );
    sub.unsubscribe();
  });

  it('cuts a relay that sends events but never completes, hangTimeout after its last event; a silent relay is left to the SDK', async () => {
    vi.useFakeTimers();
    const t = now();
    const { request } = fakeRelays(
      { [RA]: series('a', 100, { now: t }), [RB]: series('b', 100, { now: t, gap: 90 }) },
      (relay, filter, events) => {
        if (filter.since !== undefined) return undefined; // the window REQ completes normally
        return relay === RA ? concat(of(...events), NEVER) : NEVER;
      }
    );
    const { feed } = makeFeed({ request, hangTimeout: 2_000 });
    const sub = feed.events$.subscribe();
    await vi.advanceTimersByTimeAsync(50);
    expect(feed.getStatus().relays.find((r) => r.source === RA)?.state).toBe('loading');

    await vi.advanceTimersByTimeAsync(2_100);
    const s = feed.getStatus();
    expect(s.relays.find((r) => r.source === RA)?.state).toBe('covered');
    // relay B never answered: not cut by the feed (the SDK's own response timeout owns that)
    expect(s.relays.find((r) => r.source === RB)?.state).toBe('loading');
    sub.unsubscribe();
  });

  it('an erroring relay is incomplete and counts as done; its sibling is unaffected', async () => {
    const t = now();
    const { request } = fakeRelays({ [RB]: series('b', 5, { now: t, gap: 90 }) }, (relay) =>
      relay === RA ? throwError(() => new Error('connection refused')) : undefined
    );
    const { feed } = makeFeed({ request });
    const sub = feed.events$.subscribe();
    await flush(10);
    const s = feed.getStatus();
    expect(s.relays.find((r) => r.source === RA)?.state).toBe('incomplete');
    expect(s.relays.find((r) => r.source === RB)?.state).toBe('covered');
    expect(s.settled).toBe(true);
    expect(s.exhausted).toBe(true);
    sub.unsubscribe();
  });

  it('warms the store from the cache once with cacheWarmLimit', async () => {
    const t = now();
    const { request } = fakeRelays({ [RA]: series('a', 5, { now: t }) });
    const cache = vi.fn(() => [ev(t - 5000, 'cached')]);
    const { feed, eventStore } = makeFeed({
      request,
      getRelays: () => [RA],
      cache,
      cacheWarmLimit: 100
    });
    const sub = feed.events$.subscribe();
    await flush();
    expect(cache).toHaveBeenCalledTimes(1);
    expect(cache).toHaveBeenCalledWith([{ kinds: [1], limit: 100 }]);
    expect(eventStore.hasEvent('cached')).toBe(true);
    sub.unsubscribe();
  });

  it('cache: null skips the warm', async () => {
    const t = now();
    const { request } = fakeRelays({ [RA]: series('a', 5, { now: t }) });
    const { cacheRequest } = await import('$lib/stores/event-cache.svelte.js');
    const { feed } = makeFeed({ request, getRelays: () => [RA], cache: null });
    const sub = feed.events$.subscribe();
    await flush();
    expect(cacheRequest).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('no relays: exhausted and settled, no requests', async () => {
    const { request, calls } = fakeRelays({});
    const { feed } = makeFeed({ request, getRelays: () => [] });
    const sub = feed.events$.subscribe();
    await flush();
    expect(calls).toHaveLength(0);
    expect(feed.getStatus()).toMatchObject({ exhausted: true, settled: true, pending: false });
    sub.unsubscribe();
  });

  it('a relay that ignores until does not loop', async () => {
    const t = now();
    const all = series('a', 60, { now: t });
    const { request, calls } = fakeRelays({ [RA]: all }, (relay, filter) =>
      filter.since !== undefined ? undefined : of(...all.slice(0, 50))
    );
    const { feed } = makeFeed({ request, getRelays: () => [RA] });
    const sub = feed.events$.subscribe();
    await flush(20);
    expect(calls.length).toBeLessThan(10);
    expect(feed.getStatus().settled).toBe(true);
    sub.unsubscribe();
  });

  it('keeps every event across a page edge where several share one created_at', async () => {
    const t = now();
    const a = series('a', 70, { now: t });
    // Events 47..53 share the 50th event's second: the first page is cut inside that second
    for (let i = 47; i <= 53; i++) a[i].created_at = a[49].created_at;
    const { request } = fakeRelays({ [RA]: a });
    const { feed, eventStore } = makeFeed({ request, getRelays: () => [RA] });
    const sub = feed.events$.subscribe();
    await flush(10);
    for (let i = 0; i < 4; i++) {
      feed.loadMore();
      await flush(10);
    }
    const { since } = feed.getStatus();
    const expected = a.filter((e) => e.created_at >= since).length;
    expect(eventStore.getTimeline({ kinds: [1], since })).toHaveLength(expected);
    sub.unsubscribe();
  });

  it('loadMore() with a large authors filter stays one store query, no per-author requests', async () => {
    const t = now();
    const authors = Array.from({ length: 5000 }, (_, i) => i.toString(16).padStart(64, '0'));
    authors[0] = A;
    const { request, calls } = fakeRelays({ [RA]: series('a', 100, { now: t }) });
    const { feed } = makeFeed({
      request,
      getRelays: () => [RA],
      getFilter: () => ({ kinds: [1], authors })
    });
    const sub = feed.events$.subscribe();
    await flush();
    const n = calls.length;
    const started = performance.now();
    feed.loadMore();
    expect(performance.now() - started).toBeLessThan(200);
    await flush();
    expect(calls.length - n).toBeLessThanOrEqual(1);
    expect(feed.getStatus().pending).toBe(false);
    sub.unsubscribe();
  });

  it('loadMore() after unsubscribe is a no-op', async () => {
    const t = now();
    const { request, calls } = fakeRelays({ [RA]: series('a', 100, { now: t }) });
    const { feed } = makeFeed({ request, getRelays: () => [RA] });
    const sub = feed.events$.subscribe();
    await flush();
    sub.unsubscribe();
    const n = calls.length;
    expect(() => feed.loadMore()).not.toThrow();
    await flush();
    expect(calls.length).toBe(n);
  });
});

describe('completeAfterSilence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not arm before the first emission, then completes ms after the last one', async () => {
    const src = new Subject();
    let completed = false;
    /** @type {any[]} */
    const got = [];
    src
      .pipe(completeAfterSilence(100))
      .subscribe({ next: (v) => got.push(v), complete: () => (completed = true) });
    await vi.advanceTimersByTimeAsync(1000);
    expect(completed).toBe(false);
    src.next(1);
    await vi.advanceTimersByTimeAsync(99);
    src.next(2);
    await vi.advanceTimersByTimeAsync(99);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(completed).toBe(true);
    expect(got).toEqual([1, 2]);
  });

  it('passes errors and natural completion through', async () => {
    const err = new Subject();
    let caught;
    err.pipe(completeAfterSilence(100)).subscribe({ error: (e) => (caught = e) });
    err.error(new Error('boom'));
    expect(caught).toBeInstanceOf(Error);

    let done = false;
    of(1, 2)
      .pipe(completeAfterSilence(100))
      .subscribe({ complete: () => (done = true) });
    expect(done).toBe(true);
  });
});
