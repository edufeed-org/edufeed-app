/**
 * AMB Search Loader Tests
 *
 * Verifies that the NIP-50 search loaders
 * - send one request PER relay (so each relay's relevance order is preserved
 *   and can be merged by rank — the AMB relay's scores are not comparable
 *   across relays),
 * - do NOT apply curated author filtering (search is an explicit user action),
 * - expose the per-relay rank of every result.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Observable, toArray, lastValueFrom } from 'rxjs';

/** @type {Record<string, import('rxjs').Observable<any>>} */
let relayResponses = {};
const requestMock = vi.fn();

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {
    relay: vi.fn((/** @type {string} */ url) => ({
      request: (/** @type {any} */ filter, /** @type {any} */ opts) => {
        requestMock(url, filter, opts);
        return relayResponses[url] ?? new Observable((sub) => sub.complete());
      }
    }))
  },
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

import {
  ambSearchLoader,
  ambRankedSearchLoader,
  communityAMBSearchLoader
} from '../loaders/amb-search.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';

/** @param {any[]} events */
function respondWith(events) {
  return new Observable((sub) => {
    for (const e of events) sub.next(e);
    sub.complete();
  });
}

/** @param {string} id */
function ev(id) {
  return { id, kind: 30142, pubkey: 'abc', created_at: 123, tags: [['d', id]], content: '' };
}

describe('ambRankedSearchLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    relayResponses = {};
  });

  it('sends one request per configured educational relay', () => {
    ambRankedSearchLoader({ searchText: 'mathematik' }).subscribe();

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(requestMock.mock.calls.map((c) => c[0])).toEqual([
      'wss://amb-relay.example.com',
      'wss://oersi-relay.example.com'
    ]);
  });

  it('sends filter with kinds, search, and limit — and WITHOUT authors', () => {
    ambRankedSearchLoader({ searchText: 'chemie vorlesung' }, 25).subscribe();

    const filter = requestMock.mock.calls[0][1];
    expect(filter).toEqual({ kinds: [30142], search: 'chemie vorlesung', limit: 25 });
    expect(filter).not.toHaveProperty('authors');
  });

  it('emits each event with its relay and 1-based rank within that relay', async () => {
    relayResponses = {
      'wss://amb-relay.example.com': respondWith([ev('a1'), ev('a2')]),
      'wss://oersi-relay.example.com': respondWith([ev('b1')])
    };

    const results = await lastValueFrom(
      ambRankedSearchLoader({ searchText: 'test' }).pipe(toArray())
    );

    expect(results.map((r) => [r.event.id, r.relay, r.rank])).toEqual([
      ['a1', 'wss://amb-relay.example.com', 1],
      ['a2', 'wss://amb-relay.example.com', 2],
      ['b1', 'wss://oersi-relay.example.com', 1]
    ]);
  });

  it('emits the same event from two relays twice (ranks are per relay)', async () => {
    const shared = ev('shared');
    relayResponses = {
      'wss://amb-relay.example.com': respondWith([ev('a1'), shared]),
      'wss://oersi-relay.example.com': respondWith([shared])
    };

    const results = await lastValueFrom(
      ambRankedSearchLoader({ searchText: 'test' }).pipe(toArray())
    );

    expect(results.map((r) => [r.event.id, r.rank])).toEqual([
      ['a1', 1],
      ['shared', 2],
      ['shared', 1]
    ]);
  });

  it('adds events to eventStore', () => {
    const mockEvent = ev('test');
    relayResponses = { 'wss://amb-relay.example.com': respondWith([mockEvent]) };

    ambRankedSearchLoader({ searchText: 'test' }).subscribe();

    expect(eventStore.add).toHaveBeenCalledWith(mockEvent);
  });

  it('returns empty observable when no filters are active', async () => {
    const result = await lastValueFrom(ambRankedSearchLoader({}).pipe(toArray()));

    expect(result).toEqual([]);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('returns empty observable when searchText is empty string', async () => {
    const result = await lastValueFrom(ambRankedSearchLoader({ searchText: '' }).pipe(toArray()));

    expect(result).toEqual([]);
    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe('ambSearchLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    relayResponses = {};
  });

  it('emits plain events, deduplicated by id across relays', async () => {
    const shared = ev('shared');
    relayResponses = {
      'wss://amb-relay.example.com': respondWith([ev('a1'), shared]),
      'wss://oersi-relay.example.com': respondWith([shared, ev('b2')])
    };

    const results = await lastValueFrom(ambSearchLoader({ searchText: 'test' }).pipe(toArray()));

    expect(results.map((e) => e.id)).toEqual(['a1', 'shared', 'b2']);
  });

  it('uses all configured educational relays', () => {
    ambSearchLoader({ searchText: 'mathematik' }).subscribe();

    expect(requestMock.mock.calls.map((c) => c[0])).toEqual([
      'wss://amb-relay.example.com',
      'wss://oersi-relay.example.com'
    ]);
  });
});

describe('communityAMBSearchLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    relayResponses = {};
  });

  it('scopes the per-relay filter to the community via #h', () => {
    communityAMBSearchLoader('community-pubkey', { searchText: 'test' }, 10).subscribe();

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(requestMock.mock.calls[0][1]).toEqual({
      kinds: [30142],
      '#h': ['community-pubkey'],
      search: 'test',
      limit: 10
    });
  });
});
