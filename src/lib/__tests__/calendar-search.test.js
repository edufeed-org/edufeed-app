/**
 * Calendar NIP-50 Search Loader Tests
 *
 * Verifies the calendar-search loader uses pool.request() directly so the
 * NIP-50 'search' field survives, queries calendar relays for kinds 31922
 * and 31923, and pipes results through eventStore.add().
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Observable, toArray, lastValueFrom } from 'rxjs';

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { request: vi.fn(() => new Observable((sub) => sub.complete())) },
  eventStore: { add: vi.fn() }
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCalendarRelays: vi.fn(() => ['wss://calendar-a.example.com', 'wss://calendar-b.example.com'])
}));

import { calendarSearchLoader } from '../loaders/calendar-search.js';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';

describe('calendarSearchLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pool.request).mockReturnValue(new Observable((sub) => sub.complete()));
  });

  it('queries kinds 31922 and 31923 with the search field preserved', () => {
    calendarSearchLoader('biology');

    expect(pool.request).toHaveBeenCalledTimes(1);
    const filter = /** @type {any} */ (vi.mocked(pool.request).mock.calls[0][1]);
    expect(filter.kinds).toEqual([31922, 31923]);
    expect(filter.search).toBe('biology');
  });

  it('respects a custom limit', () => {
    calendarSearchLoader('chemistry', { limit: 25 });
    const filter = /** @type {any} */ (vi.mocked(pool.request).mock.calls[0][1]);
    expect(filter.limit).toBe(25);
  });

  it('uses all configured calendar relays by default', () => {
    calendarSearchLoader('math');
    const relays = vi.mocked(pool.request).mock.calls[0][0];
    expect(relays).toEqual(['wss://calendar-a.example.com', 'wss://calendar-b.example.com']);
  });

  it('honours an explicit relay override', () => {
    calendarSearchLoader('math', { relays: ['wss://override.example'] });
    const relays = vi.mocked(pool.request).mock.calls[0][0];
    expect(relays).toEqual(['wss://override.example']);
  });

  it('passes a request timeout option (5s default)', () => {
    calendarSearchLoader('history');
    const opts = vi.mocked(pool.request).mock.calls[0][2];
    expect(opts).toMatchObject({ timeout: 5000 });
  });

  it('returns an empty observable for an empty query', async () => {
    const result = await lastValueFrom(calendarSearchLoader('').pipe(toArray()));
    expect(result).toEqual([]);
    expect(pool.request).not.toHaveBeenCalled();
  });

  it('returns an empty observable for a whitespace-only query', async () => {
    const result = await lastValueFrom(calendarSearchLoader('   ').pipe(toArray()));
    expect(result).toEqual([]);
    expect(pool.request).not.toHaveBeenCalled();
  });

  it('returns an empty observable for queries shorter than the minimum length', async () => {
    const result = await lastValueFrom(calendarSearchLoader('a').pipe(toArray()));
    expect(result).toEqual([]);
    expect(pool.request).not.toHaveBeenCalled();
  });

  it('adds incoming events to eventStore', () => {
    const mockEvent = {
      id: 'evt1',
      kind: 31923,
      pubkey: 'abc',
      created_at: 123,
      tags: []
    };
    vi.mocked(pool.request).mockReturnValueOnce(
      new Observable((sub) => {
        sub.next(/** @type {any} */ (mockEvent));
        sub.complete();
      })
    );

    calendarSearchLoader('test').subscribe();
    expect(eventStore.add).toHaveBeenCalledWith(mockEvent);
  });
});
