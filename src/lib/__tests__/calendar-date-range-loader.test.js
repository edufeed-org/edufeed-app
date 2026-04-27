/**
 * createDateRangeCalendarLoader Tests
 *
 * Verifies the loader fetches events that *overlap* the window, not just those
 * starting inside it — previously multi-day events starting before the window
 * but ending inside it were silently dropped.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of, firstValueFrom, toArray } from 'rxjs';

// app-settings touches window.matchMedia at module load through relay-helper's
// transitive imports; stub it before mocks run.
if (typeof window !== 'undefined' && !window.matchMedia) {
  // @ts-expect-error minimal shim for module-load-time calls
  window.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {}
  });
}

// Capture every filter that reaches the relay so we can assert on its shape.
/** @type {any[]} */
let capturedNip52Filters = [];
/** @type {any[]} */
let capturedStandardFilters = [];

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

vi.mock('$lib/loaders/base.js', () => ({
  timedPool: vi.fn((relays, filter) => {
    // Route based on the partitioning logic below.
    if (relays.includes('wss://nip52.example')) {
      capturedNip52Filters.push(filter);
    } else {
      capturedStandardFilters.push(filter);
    }
    return of(); // Empty stream — we only care about the filter shape.
  }),
  addressLoader: vi.fn(() => of()),
  eventLoader: vi.fn(() => of()),
  unifiedLoader: vi.fn(() => of())
}));

vi.mock('$lib/helpers/relay-helper.js', async (importOriginal) => {
  const orig = /** @type {any} */ (await importOriginal());
  return {
    ...orig,
    getCalendarRelays: vi.fn(() => ['wss://nip52.example', 'wss://standard.example'])
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

const { createDateRangeCalendarLoader } = await import('../loaders/calendar.js');

describe('createDateRangeCalendarLoader', () => {
  beforeEach(() => {
    capturedNip52Filters = [];
    capturedStandardFilters = [];
  });

  it('sends #start_before and #end_after to NIP-52 relays for overlap semantics', async () => {
    const rangeStart = 1_700_000_000;
    const rangeEnd = 1_710_000_000;

    const loader = createDateRangeCalendarLoader({ rangeStart, rangeEnd });
    await firstValueFrom(loader().pipe(toArray()));

    expect(capturedNip52Filters).toHaveLength(1);
    const f = capturedNip52Filters[0];
    expect(f['#start_before']).toEqual([String(rangeEnd)]);
    expect(f['#end_after']).toEqual([String(rangeStart)]);
    // Start-only legacy filter must not leak through.
    expect(f['#start_after']).toBeUndefined();
    expect(f['#end_before']).toBeUndefined();
    expect(f.kinds).toEqual([31922, 31923]);
  });

  it('sends standard kinds filter (no date fields) to non-NIP-52 relays', async () => {
    const loader = createDateRangeCalendarLoader({
      rangeStart: 1_700_000_000,
      rangeEnd: 1_710_000_000
    });
    await firstValueFrom(loader().pipe(toArray()));

    expect(capturedStandardFilters).toHaveLength(1);
    const f = capturedStandardFilters[0];
    expect(f.kinds).toEqual([31922, 31923]);
    expect(f.limit).toBe(500);
    expect(f['#start_before']).toBeUndefined();
    expect(f['#end_after']).toBeUndefined();
  });

  it('passes explicit authors into both filters', async () => {
    const loader = createDateRangeCalendarLoader(
      { rangeStart: 1, rangeEnd: 2 },
      { authors: ['abc', 'def'] }
    );
    await firstValueFrom(loader().pipe(toArray()));

    expect(capturedNip52Filters[0].authors).toEqual(['abc', 'def']);
    expect(capturedStandardFilters[0].authors).toEqual(['abc', 'def']);
  });

  it('uses explicit options.relays in place of getCalendarRelays()', async () => {
    const { partitionRelaysByNip52Support } = await import('$lib/services/relay-capabilities.js');
    const { getCalendarRelays } = await import('$lib/helpers/relay-helper.js');
    /** @type {any} */ (partitionRelaysByNip52Support).mockClear();
    /** @type {any} */ (getCalendarRelays).mockClear();

    // Override the default relay list so we can prove the custom ones are used.
    /** @type {any} */ (getCalendarRelays).mockReturnValueOnce([
      'wss://should-not-be-used.example'
    ]);

    const customRelays = ['wss://nip52.example', 'wss://standard.example'];
    const loader = createDateRangeCalendarLoader(
      { rangeStart: 1, rangeEnd: 2 },
      { relays: customRelays }
    );
    await firstValueFrom(loader().pipe(toArray()));

    // Partition must receive the caller-supplied relays, not the defaults.
    expect(partitionRelaysByNip52Support).toHaveBeenCalledWith(customRelays);
    expect(getCalendarRelays).not.toHaveBeenCalled();

    // And both branches' filters must have been emitted against the caller's relays.
    expect(capturedNip52Filters).toHaveLength(1);
    expect(capturedStandardFilters).toHaveLength(1);
  });

  it('falls back to getCalendarRelays() when options.relays is empty or missing', async () => {
    const { getCalendarRelays } = await import('$lib/helpers/relay-helper.js');
    /** @type {any} */ (getCalendarRelays).mockClear();

    const loader = createDateRangeCalendarLoader({ rangeStart: 1, rangeEnd: 2 }, { relays: [] });
    await firstValueFrom(loader().pipe(toArray()));

    expect(getCalendarRelays).toHaveBeenCalled();
  });
});
