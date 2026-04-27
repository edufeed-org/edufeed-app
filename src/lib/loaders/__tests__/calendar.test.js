/**
 * createRelayFilteredCalendarLoader Tests
 *
 * Regression: previously the loader leaked an empty `authors: []` into the REQ
 * filter via `...additionalFilters`, which the relay interprets as "no authors
 * match" and returns nothing. The fix destructures `authors` out of the spread
 * and only re-adds it when non-empty.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { firstValueFrom, of, toArray } from 'rxjs';

if (typeof window !== 'undefined' && !window.matchMedia) {
  // @ts-expect-error minimal shim for module-load-time calls
  window.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {}
  });
}

/** @type {any[]} */
let capturedStandardFilters;
/** @type {any[]} */
let capturedNip52Filters;

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {},
  eventStore: { add: vi.fn() }
}));

vi.mock('applesauce-loaders/loaders', async (importOriginal) => {
  const orig = /** @type {any} */ (await importOriginal());
  return {
    ...orig,
    createTimelineLoader: vi.fn(() => () => of()),
    createAddressLoader: vi.fn(() => vi.fn(() => of())),
    createEventLoader: vi.fn(() => vi.fn(() => of())),
    createUnifiedEventLoader: vi.fn(() => vi.fn(() => of()))
  };
});

vi.mock('../base.js', () => ({
  timedPool: vi.fn((relays, filter) => {
    if (relays.includes('wss://nip52.example')) {
      capturedNip52Filters.push(filter);
    } else {
      capturedStandardFilters.push(filter);
    }
    return of();
  }),
  addressLoader: vi.fn(() => of()),
  eventLoader: vi.fn(() => of()),
  unifiedLoader: vi.fn(() => of()),
  createCachedTimelineLoader: vi.fn(() => () => of())
}));

vi.mock('$lib/helpers/relay-helper.js', async (importOriginal) => {
  const orig = /** @type {any} */ (await importOriginal());
  return {
    ...orig,
    getCalendarRelays: vi.fn(() => ['wss://standard.example'])
  };
});

vi.mock('$lib/services/relay-capabilities.js', () => ({
  partitionRelaysByNip52Support: vi.fn(async (/** @type {string[]} */ relays) => ({
    nip52Relays: relays.filter((r) => r.includes('nip52')),
    standardRelays: relays.filter((r) => !r.includes('nip52'))
  })),
  preWarmRelayCapabilitiesCache: vi.fn()
}));

vi.mock('$lib/services/curated-authors-service.svelte.js', () => ({
  getCuratedAuthors: vi.fn(() => null),
  applyCuratedFilter: vi.fn((/** @type {any} */ f) => f)
}));

const { createRelayFilteredCalendarLoader } = await import('../calendar.js');

describe('createRelayFilteredCalendarLoader', () => {
  beforeEach(() => {
    capturedStandardFilters = [];
    capturedNip52Filters = [];
  });

  it('does NOT include `authors` in the REQ filter when authors is an empty array', async () => {
    const loader = createRelayFilteredCalendarLoader([], { authors: [] });
    await firstValueFrom(loader().pipe(toArray()));

    expect(capturedStandardFilters).toHaveLength(1);
    const f = capturedStandardFilters[0];
    expect(f.authors).toBeUndefined();
    expect(f.kinds).toEqual([31922, 31923]);
  });

  it('includes `authors` in the REQ filter when explicit authors are provided', async () => {
    const loader = createRelayFilteredCalendarLoader([], { authors: ['abc', 'def'] });
    await firstValueFrom(loader().pipe(toArray()));

    expect(capturedStandardFilters).toHaveLength(1);
    expect(capturedStandardFilters[0].authors).toEqual(['abc', 'def']);
  });

  it('falls back to curated authors when explicit authors are empty', async () => {
    const { getCuratedAuthors } = await import('$lib/services/curated-authors-service.svelte.js');
    /** @type {any} */ (getCuratedAuthors).mockReturnValueOnce(['curated-pubkey']);

    const loader = createRelayFilteredCalendarLoader([], { authors: [] });
    await firstValueFrom(loader().pipe(toArray()));

    expect(capturedStandardFilters[0].authors).toEqual(['curated-pubkey']);
  });

  it('paginates standard relays with PAGE_SIZE=100 (no hard-coded limit:200)', async () => {
    const loader = createRelayFilteredCalendarLoader([], { authors: [] });
    await firstValueFrom(loader().pipe(toArray()));

    expect(capturedStandardFilters[0].limit).toBe(100);
  });
});
