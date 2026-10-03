/**
 * channelCalendarsLoader (M5): one timeline loader per group relay, reading
 * the channels' meetings (and their h-tagged deletions) into the eventStore,
 * authenticated first when a signer is at hand.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of, throwError, lastValueFrom, toArray } from 'rxjs';

if (typeof window !== 'undefined' && !window.matchMedia) {
  // @ts-expect-error minimal shim for module-load-time calls
  window.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {}
  });
}

/** @type {string[]} */
const order = [];
const relayFor = vi.fn((/** @type {string} */ url) => ({ url }));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: (/** @type {string} */ url) => relayFor(url) },
  eventStore: { add: vi.fn() }
}));

vi.mock('applesauce-loaders/loaders', async (importOriginal) => {
  const orig = /** @type {any} */ (await importOriginal());
  return {
    ...orig,
    createTimelineLoader: vi.fn((_pool, relays, filter) => () => {
      const id = filter['#h'][0];
      order.push(`load ${relays.join(',')}`);
      // pyramid CLOSEs a REQ naming a private group for a non-member
      if (id === 'private') return throwError(() => new Error('auth-required'));
      return of({ id: `event-${id}-from-${relays[0]}` });
    })
  };
});

vi.mock('$lib/loaders/base.js', () => ({
  timedPool: vi.fn(() => of()),
  addressLoader: vi.fn(() => of()),
  createCachedTimelineLoader: vi.fn(() => () => of())
}));

vi.mock('$lib/groups/relay-auth.js', () => ({
  authenticateOnce: vi.fn(async (/** @type {any} */ relay) => {
    order.push(`auth ${relay.url}`);
    return { ok: true };
  })
}));

vi.mock('$lib/services/curated-authors-service.svelte.js', () => ({
  getCuratedAuthors: vi.fn(() => null),
  applyCuratedFilter: vi.fn((/** @type {any} */ f) => f)
}));

const { channelCalendarsLoader } = await import('$lib/loaders/calendar.js');
const { createTimelineLoader } = await import('applesauce-loaders/loaders');
const { authenticateOnce } = await import('$lib/groups/relay-auth.js');
const { timedPool } = await import('$lib/loaders/base.js');
const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');

const R1 = 'wss://groups.example/c/root1';
const R2 = 'wss://other.example';

describe('channelCalendarsLoader', () => {
  beforeEach(() => {
    order.length = 0;
    vi.mocked(createTimelineLoader).mockClear();
    vi.mocked(authenticateOnce).mockClear();
  });

  it('opens one timeline loader per channel (one #h each) on its relay', async () => {
    const events = await lastValueFrom(
      channelCalendarsLoader([
        { id: 'a', relay: R1 },
        { id: 'b', relay: R1 },
        { id: 'z', relay: R2 }
      ])().pipe(toArray())
    );

    expect(createTimelineLoader).toHaveBeenCalledTimes(3);
    expect(vi.mocked(createTimelineLoader).mock.calls[0]).toEqual([
      timedPool,
      [R1],
      { kinds: [31923, 5, 9005], '#h': ['a'], limit: 250 },
      { eventStore }
    ]);
    const calls = vi
      .mocked(createTimelineLoader)
      .mock.calls.map((c) => [c[1][0], /** @type {any} */ (c[2])['#h']]);
    expect(calls).toEqual([
      [R1, ['a']],
      [R1, ['b']],
      [R2, ['z']]
    ]);
    expect(events).toHaveLength(3);
  });

  it("a channel the relay refuses (CLOSED) does not hide another channel's meetings", async () => {
    const events = await lastValueFrom(
      channelCalendarsLoader([
        { id: 'private', relay: R1 },
        { id: 'open', relay: R1 }
      ])().pipe(toArray())
    );
    expect(events.map((e) => e.id)).toEqual([`event-open-from-${R1}`]);
  });

  it('authenticates once per relay, not per channel', async () => {
    await lastValueFrom(
      channelCalendarsLoader(
        [
          { id: 'a', relay: R1 },
          { id: 'b', relay: R1 }
        ],
        { signer: {} }
      )().pipe(toArray())
    );
    expect(authenticateOnce).toHaveBeenCalledTimes(1);
  });

  it('does not authenticate without a signer', async () => {
    await lastValueFrom(channelCalendarsLoader([{ id: 'a', relay: R1 }])().pipe(toArray()));
    expect(authenticateOnce).not.toHaveBeenCalled();
  });

  it('authenticates on each relay before reading it when a signer is given', async () => {
    const signer = {};
    await lastValueFrom(
      channelCalendarsLoader(
        [
          { id: 'a', relay: R1 },
          { id: 'z', relay: R2 }
        ],
        { signer }
      )().pipe(toArray())
    );
    expect(authenticateOnce).toHaveBeenCalledTimes(2);
    expect(vi.mocked(authenticateOnce).mock.calls[0][1]).toBe(signer);
    expect(order.indexOf(`auth ${R1}`)).toBeLessThan(order.indexOf(`load ${R1}`));
    expect(order.indexOf(`auth ${R2}`)).toBeLessThan(order.indexOf(`load ${R2}`));
  });

  it('still reads (what is public) when authentication fails', async () => {
    vi.mocked(authenticateOnce).mockResolvedValueOnce({ ok: false, message: 'no challenge' });
    const events = await lastValueFrom(
      channelCalendarsLoader([{ id: 'a', relay: R1 }], { signer: {} })().pipe(toArray())
    );
    expect(events).toHaveLength(1);
  });

  it('emits nothing for no pointers', async () => {
    const events = await lastValueFrom(channelCalendarsLoader([])().pipe(toArray()), {
      defaultValue: []
    });
    expect(events).toEqual([]);
    expect(createTimelineLoader).not.toHaveBeenCalled();
  });
});
