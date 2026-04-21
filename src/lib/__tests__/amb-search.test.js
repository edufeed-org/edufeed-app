/**
 * AMB Search Loader Tests
 *
 * Verifies that ambSearchLoader sends NIP-50 search filters WITHOUT curated
 * author filtering. NIP-50 search is an explicit user action — results should
 * come from all configured AMB relays, not be restricted to curated authors.
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
  getEducationalRelays: vi.fn(() => [
    'wss://amb-relay.example.com',
    'wss://oersi-relay.example.com'
  ]),
  getEventLoaderLookupRelays: () => []
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { appRelays: {} }
}));

import { ambSearchLoader } from '../loaders/amb-search.js';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';

describe('ambSearchLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default mock implementation
    vi.mocked(pool.request).mockReturnValue(new Observable((sub) => sub.complete()));
  });

  it('sends filter WITHOUT authors field', () => {
    ambSearchLoader({ searchText: 'chemie vorlesung' });

    expect(pool.request).toHaveBeenCalledTimes(1);
    const filter = vi.mocked(pool.request).mock.calls[0][1];
    expect(filter).not.toHaveProperty('authors');
  });

  it('sends filter with kinds, search, and limit', () => {
    ambSearchLoader({ searchText: 'chemie vorlesung' }, 25);

    const filter = vi.mocked(pool.request).mock.calls[0][1];
    expect(filter).toEqual({
      kinds: [30142],
      search: 'chemie vorlesung',
      limit: 25
    });
  });

  it('uses all configured educational relays', () => {
    ambSearchLoader({ searchText: 'mathematik' });

    const relays = vi.mocked(pool.request).mock.calls[0][0];
    expect(relays).toEqual(['wss://amb-relay.example.com', 'wss://oersi-relay.example.com']);
  });

  it('returns empty observable when no filters are active', async () => {
    const result = await lastValueFrom(ambSearchLoader({}).pipe(toArray()));

    expect(result).toEqual([]);
    expect(pool.request).not.toHaveBeenCalled();
  });

  it('returns empty observable when searchText is empty string', async () => {
    const result = await lastValueFrom(ambSearchLoader({ searchText: '' }).pipe(toArray()));

    expect(result).toEqual([]);
    expect(pool.request).not.toHaveBeenCalled();
  });

  it('adds events to eventStore', () => {
    const mockEvent = { id: 'test', kind: 30142, pubkey: 'abc', created_at: 123, tags: [] };

    vi.mocked(pool.request).mockReturnValueOnce(
      new Observable((sub) => {
        sub.next(/** @type {any} */ (mockEvent));
        sub.complete();
      })
    );

    ambSearchLoader({ searchText: 'test' }).subscribe();

    expect(eventStore.add).toHaveBeenCalledWith(mockEvent);
  });
});
