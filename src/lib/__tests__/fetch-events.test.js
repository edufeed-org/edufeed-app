/** @vitest-environment node */
// The one-shot primitives every "latest N" surface uses: one request, events
// into the EventStore, and an observable that completes (applesauce v7's
// timeline loader is window-based; nothing here pages).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventStore } from 'applesauce-core';
import { lastValueFrom, of, Subject, throwError, toArray } from 'rxjs';

const eventStore = new EventStore({ verifyEvent: () => true });
const request = vi.fn();
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { request: (/** @type {any[]} */ ...args) => request(...args) },
  eventStore
}));
/** @type {import('vitest').Mock<(filters: any) => Promise<any[]>>} */
const cacheRequest = vi.fn(async (_filters) => [ev(250, 'cached')]);
vi.mock('$lib/stores/event-cache.svelte.js', () => ({
  cacheRequest: (/** @type {any} */ filters) => cacheRequest(filters)
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://lookup.example/'],
  getEventLoaderLookupRelays: () => []
}));

/** @param {number} createdAt */
function ev(createdAt, id = `id-${createdAt}`, pubkey = 'a'.repeat(64)) {
  return {
    id,
    kind: 1,
    pubkey,
    created_at: createdAt,
    content: '',
    tags: [],
    sig: 'b'.repeat(128)
  };
}

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

beforeEach(() => {
  request.mockReset();
  cacheRequest.mockClear();
});

describe('fetchEvents', () => {
  it('requests the relays through timedPool, stores the events and completes', async () => {
    const { fetchEvents } = await import('$lib/loaders/base.js');
    request.mockReturnValue(of(ev(300)));

    const got = await lastValueFrom(
      fetchEvents(['wss://a.example/'], { kinds: [1] }).pipe(toArray())
    );

    expect(request).toHaveBeenCalledWith(
      ['wss://a.example/'],
      [{ kinds: [1] }],
      expect.objectContaining({ timeout: 10_000 })
    );
    expect(got.map((e) => e.id)).toEqual(['id-300']);
    expect(eventStore.hasEvent('id-300')).toBe(true);
    expect(cacheRequest).not.toHaveBeenCalled();
  });

  it('cache: true replays the IDB cache alongside the relays', async () => {
    const { fetchEvents } = await import('$lib/loaders/base.js');
    request.mockReturnValue(of(ev(301)));

    const got = await lastValueFrom(
      fetchEvents(['wss://a.example/'], [{ kinds: [1], limit: 5 }], { cache: true }).pipe(toArray())
    );

    expect(cacheRequest).toHaveBeenCalledWith([{ kinds: [1], limit: 5 }]);
    expect(got.map((e) => e.id).sort()).toEqual(['cached', 'id-301']);
    expect(eventStore.hasEvent('cached')).toBe(true);
  });

  it('completes (empty) when the relay group errors', async () => {
    const { fetchEvents } = await import('$lib/loaders/base.js');
    request.mockReturnValue(throwError(() => new Error('all relays failed')));

    const got = await lastValueFrom(
      fetchEvents(['wss://a.example/'], { kinds: [1] }).pipe(toArray())
    );
    expect(got).toEqual([]);
  });
});

describe('fetchOutbox', () => {
  it('requests each relay once per newly seen author set', async () => {
    const { fetchOutbox } = await import('$lib/loaders/base.js');
    request.mockImplementation((relays, filters) =>
      of(
        ev(
          400 + request.mock.calls.length,
          `out-${request.mock.calls.length}`,
          filters[0].authors[0]
        )
      )
    );
    const outboxes$ = new Subject();
    const collected = lastValueFrom(
      fetchOutbox(outboxes$, { kinds: [1], limit: 50 }).pipe(toArray())
    );

    outboxes$.next({ 'wss://a.example/': [{ pubkey: A }] });
    outboxes$.next({
      'wss://a.example/': [{ pubkey: A }, { pubkey: B }],
      'wss://b.example/': [{ pubkey: A }]
    });
    // Same map again: nothing new to ask for
    outboxes$.next({
      'wss://a.example/': [{ pubkey: A }, { pubkey: B }],
      'wss://b.example/': [{ pubkey: A }]
    });
    outboxes$.complete();

    const got = await collected;
    const calls = request.mock.calls.map(([relays, filters]) => [relays[0], filters[0]]);
    expect(calls).toEqual([
      ['wss://a.example/', { kinds: [1], limit: 50, authors: [A] }],
      ['wss://a.example/', { kinds: [1], limit: 50, authors: [B] }],
      ['wss://b.example/', { kinds: [1], limit: 50, authors: [A] }]
    ]);
    expect(got).toHaveLength(3);
  });

  it('accepts a plain outbox map', async () => {
    const { fetchOutbox } = await import('$lib/loaders/base.js');
    request.mockReturnValue(of());
    await lastValueFrom(
      fetchOutbox({ 'wss://a.example/': [{ pubkey: A }] }, { kinds: [1] }).pipe(toArray())
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toEqual([{ kinds: [1], authors: [A] }]);
  });
});

describe('deletion fetchers', () => {
  // Asking for "every deletion of these authors" downloaded 250 bulk deletion
  // events (3.8 MB) from the OERSI relay on every page load, and still missed
  // most of them (the relay holds 1594). Asking which deletions name the
  // events at hand is exact and small.
  it('fetchDeletionsOf asks every lookup relay for the kind 5s that name the given events', async () => {
    const { fetchDeletionsOf } = await import('$lib/loaders/base.js');
    request.mockReturnValue(of());
    const note = ev(1, '1'.repeat(64));
    const resource = { ...ev(2, '2'.repeat(64)), kind: 30142, tags: [['d', 'x']] };
    const pointer = { kind: 31923, pubkey: B, identifier: 'y' };

    await lastValueFrom(fetchDeletionsOf([note, resource, pointer]).pipe(toArray()));

    expect(request.mock.calls.every((call) => call[0][0] === 'wss://lookup.example/')).toBe(true);
    const filters = request.mock.calls.flatMap((call) => call[1]);
    // one question per event: the id of a regular event, the address of a replaceable one
    expect(filters).toContainEqual({ kinds: [5], '#e': ['1'.repeat(64)] });
    expect(filters).toContainEqual({ kinds: [5], '#a': [`30142:${A}:x`, `31923:${B}:y`] });
    expect(filters.some((f) => f.authors)).toBe(false);
  });

  // A model emits again and again; a surface passes one Set and each event is
  // asked about once (the calendar loaders, issue wccpzn73).
  it('fetchDeletionsOf with an `asked` set asks about each event only once', async () => {
    const { fetchDeletionsOf } = await import('$lib/loaders/base.js');
    request.mockReturnValue(of());
    const asked = new Set();
    const a = { kind: 31923, pubkey: A, tags: [['d', 'one']] };
    const b = { kind: 31923, pubkey: B, identifier: 'two' };

    await lastValueFrom(fetchDeletionsOf([a], { asked }).pipe(toArray()));
    await lastValueFrom(fetchDeletionsOf([a, b], { asked }).pipe(toArray()));
    await lastValueFrom(fetchDeletionsOf([a, b], { asked }).pipe(toArray()));

    const filters = request.mock.calls.flatMap((call) => call[1]);
    expect(filters).toEqual([
      { kinds: [5], '#a': [`31923:${A}:one`] },
      { kinds: [5], '#a': [`31923:${B}:two`] }
    ]);
  });

  it('the calendar loaders ask about the events at hand, never author-wide', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/lib/loaders/calendar-event-loader.svelte.js', 'utf8');
    expect(source).not.toMatch(/fetchUserDeletions|fetchAuthorsDeletions/);
    expect(source).toMatch(/fetchDeletionsOf/);
  });

  it('fetchDeletionsOf stores a deletion it finds, which removes the deleted event', async () => {
    const { fetchDeletionsOf } = await import('$lib/loaders/base.js');
    const resource = { ...ev(2, '3'.repeat(64)), kind: 30142, tags: [['d', 'gone']] };
    eventStore.add(resource);
    const deletion = { ...ev(9, '4'.repeat(64)), kind: 5, tags: [['a', `30142:${A}:gone`]] };
    request.mockImplementation((_relays, filters) => (filters[0]['#a'] ? of(deletion) : of()));

    await lastValueFrom(fetchDeletionsOf([resource]).pipe(toArray()));

    expect(eventStore.getEvent(resource.id)).toBeUndefined();
  });

  it('fetchAuthorsDeletions asks every lookup relay for the authors’ kind 5s', async () => {
    const { fetchAuthorsDeletions } = await import('$lib/loaders/base.js');
    request.mockReturnValue(of());
    await lastValueFrom(fetchAuthorsDeletions([A, B]).pipe(toArray()));
    expect(request).toHaveBeenCalledWith(
      ['wss://lookup.example/'],
      [{ kinds: [5], authors: [A, B], limit: 500 }],
      expect.anything()
    );
  });

  it('fetchUserDeletions is the single-author form', async () => {
    const { fetchUserDeletions } = await import('$lib/loaders/base.js');
    request.mockReturnValue(of());
    await lastValueFrom(fetchUserDeletions(A).pipe(toArray()));
    expect(request.mock.calls[0][1]).toEqual([{ kinds: [5], authors: [A], limit: 500 }]);
  });
});
