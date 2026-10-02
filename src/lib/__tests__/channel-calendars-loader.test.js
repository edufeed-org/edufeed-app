/**
 * channelCalendarsLoader (M5): one timeline loader per group relay, reading
 * the channels' meetings (and their h-tagged deletions) into the eventStore,
 * authenticated first when a signer is at hand.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of, lastValueFrom, toArray } from 'rxjs';

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
    createTimelineLoader: vi.fn((_pool, relays) => () => {
      order.push(`load ${relays.join(',')}`);
      return of({ id: `event-from-${relays[0]}` });
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

  it('opens one timeline loader per relay with the channel ids as #h', async () => {
    const events = await lastValueFrom(
      channelCalendarsLoader([
        { id: 'a', relay: R1 },
        { id: 'b', relay: R1 },
        { id: 'z', relay: R2 }
      ])().pipe(toArray())
    );

    expect(createTimelineLoader).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createTimelineLoader).mock.calls[0]).toEqual([
      timedPool,
      [R1],
      [
        { kinds: [31923], '#h': ['a', 'b'], limit: 250 },
        { kinds: [5], '#h': ['a', 'b'], limit: 100 }
      ],
      { eventStore }
    ]);
    expect(vi.mocked(createTimelineLoader).mock.calls[1][1]).toEqual([R2]);
    expect(/** @type {any} */ (vi.mocked(createTimelineLoader).mock.calls[1][2])[0]['#h']).toEqual([
      'z'
    ]);
    expect(events).toHaveLength(2);
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
