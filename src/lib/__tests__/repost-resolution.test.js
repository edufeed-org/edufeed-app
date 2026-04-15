/**
 * Repost Resolution Utility Tests
 *
 * Tests the shared resolveRepostReferences() and fetchEventsByIds() functions
 * that extract embedded events and fetch referenced content from relays.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';

vi.mock('applesauce-common/helpers', () => ({
  getEmbededSharedEvent: vi.fn(),
  getSharedEventPointer: vi.fn(),
  getSharedAddressPointer: vi.fn()
}));

import {
  getEmbededSharedEvent,
  getSharedEventPointer,
  getSharedAddressPointer
} from 'applesauce-common/helpers';
import { resolveRepostReferences, fetchEventsByIds } from '$lib/helpers/repost-resolution.js';

describe('fetchEventsByIds', () => {
  it('returns undefined for empty ID list', () => {
    const pool = { request: vi.fn(() => of()) };
    const eventStore = { add: vi.fn() };
    const result = fetchEventsByIds([], ['wss://relay.example.com'], { pool, eventStore });
    expect(result).toBeUndefined();
    expect(pool.request).not.toHaveBeenCalled();
  });

  it('calls pool.request with correct filter and adds events to eventStore', () => {
    const mockEvent = { id: 'evt1', kind: 1, pubkey: 'pk1' };
    const pool = { request: vi.fn(() => of(mockEvent)) };
    const eventStore = { add: vi.fn() };
    const relays = ['wss://relay1.example.com'];

    const sub = fetchEventsByIds(['evt1'], relays, { pool, eventStore });

    expect(sub).toBeDefined();
    expect(pool.request).toHaveBeenCalledWith(relays, [{ ids: ['evt1'] }], expect.any(Object));
    expect(eventStore.add).toHaveBeenCalledWith(mockEvent);
  });
});

describe('resolveRepostReferences', () => {
  /** @type {any} */
  let pool;
  /** @type {any} */
  let eventStore;
  /** @type {any} */
  let addrLoader;
  const relays = ['wss://relay.example.com'];

  beforeEach(() => {
    vi.clearAllMocks();
    pool = { request: vi.fn(() => of()) };
    eventStore = { add: vi.fn() };
    addrLoader = vi.fn(() => ({ subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) }));
  });

  it('extracts embedded event from content and adds to eventStore', () => {
    const embedded = { id: 'orig1', kind: 1, pubkey: 'author1' };
    /** @type {any} */ (getEmbededSharedEvent).mockReturnValue(embedded);
    /** @type {any} */ (getSharedEventPointer).mockReturnValue(undefined);
    /** @type {any} */ (getSharedAddressPointer).mockReturnValue(undefined);

    const repost = { id: 'rp1', kind: 6, content: JSON.stringify(embedded), tags: [] };

    resolveRepostReferences([repost], {
      eventStore,
      pool,
      addressLoader: addrLoader,
      relays
    });

    expect(eventStore.add).toHaveBeenCalledWith(embedded);
  });

  it('collects e-tag IDs and fetches via pool.request', () => {
    /** @type {any} */ (getEmbededSharedEvent).mockReturnValue(undefined);
    /** @type {any} */ (getSharedEventPointer).mockReturnValue({ id: 'evt1', relays: [] });
    /** @type {any} */ (getSharedAddressPointer).mockReturnValue(undefined);

    const repost = { id: 'rp1', kind: 6, tags: [['e', 'evt1']], content: '' };

    resolveRepostReferences([repost], {
      eventStore,
      pool,
      addressLoader: addrLoader,
      relays
    });

    expect(pool.request).toHaveBeenCalledWith(relays, [{ ids: ['evt1'] }], expect.any(Object));
  });

  it('resolves a-tag via addressLoader', () => {
    /** @type {any} */ (getEmbededSharedEvent).mockReturnValue(undefined);
    /** @type {any} */ (getSharedEventPointer).mockReturnValue(undefined);
    /** @type {any} */ (getSharedAddressPointer).mockReturnValue({
      kind: 30142,
      pubkey: 'author1',
      identifier: 'my-resource'
    });

    const repost = { id: 'rp1', kind: 16, tags: [['a', '30142:author1:my-resource']], content: '' };

    resolveRepostReferences([repost], {
      eventStore,
      pool,
      addressLoader: addrLoader,
      relays
    });

    expect(addrLoader).toHaveBeenCalledWith({
      kind: 30142,
      pubkey: 'author1',
      identifier: 'my-resource',
      relays
    });
  });

  it('deduplicates already-resolved event IDs', () => {
    /** @type {any} */ (getEmbededSharedEvent).mockReturnValue(undefined);
    /** @type {any} */ (getSharedEventPointer).mockReturnValue({ id: 'evt1', relays: [] });
    /** @type {any} */ (getSharedAddressPointer).mockReturnValue(undefined);

    const repost1 = { id: 'rp1', kind: 6, tags: [['e', 'evt1']], content: '' };
    const repost2 = { id: 'rp2', kind: 6, tags: [['e', 'evt1']], content: '' };

    resolveRepostReferences([repost1, repost2], {
      eventStore,
      pool,
      addressLoader: addrLoader,
      relays
    });

    // Should only have 'evt1' once in the IDs
    expect(pool.request).toHaveBeenCalledTimes(1);
    expect(pool.request).toHaveBeenCalledWith(relays, [{ ids: ['evt1'] }], expect.any(Object));
  });

  it('respects pre-populated loadedIds set', () => {
    /** @type {any} */ (getEmbededSharedEvent).mockReturnValue(undefined);
    /** @type {any} */ (getSharedEventPointer).mockReturnValue({ id: 'evt1', relays: [] });
    /** @type {any} */ (getSharedAddressPointer).mockReturnValue(undefined);

    const repost = { id: 'rp1', kind: 6, tags: [['e', 'evt1']], content: '' };
    const loadedIds = new Set(['evt1']); // already loaded

    resolveRepostReferences([repost], {
      eventStore,
      pool,
      addressLoader: addrLoader,
      relays,
      loadedIds
    });

    // Should not fetch since evt1 is already in loadedIds
    expect(pool.request).not.toHaveBeenCalled();
  });

  it('handles reposts with both e-tag and a-tag', () => {
    /** @type {any} */ (getEmbededSharedEvent).mockReturnValue(undefined);
    /** @type {any} */ (getSharedEventPointer).mockReturnValue({ id: 'evt1', relays: [] });
    /** @type {any} */ (getSharedAddressPointer).mockReturnValue({
      kind: 30142,
      pubkey: 'author1',
      identifier: 'slug'
    });

    const repost = {
      id: 'rp1',
      kind: 16,
      tags: [
        ['e', 'evt1'],
        ['a', '30142:author1:slug']
      ],
      content: ''
    };

    resolveRepostReferences([repost], {
      eventStore,
      pool,
      addressLoader: addrLoader,
      relays
    });

    // Both should be resolved
    expect(pool.request).toHaveBeenCalled();
    expect(addrLoader).toHaveBeenCalled();
  });

  it('returns subscriptions for cleanup', () => {
    /** @type {any} */ (getEmbededSharedEvent).mockReturnValue(undefined);
    /** @type {any} */ (getSharedEventPointer).mockReturnValue({ id: 'evt1', relays: [] });
    /** @type {any} */ (getSharedAddressPointer).mockReturnValue(undefined);

    const repost = { id: 'rp1', kind: 6, tags: [['e', 'evt1']], content: '' };

    const subs = resolveRepostReferences([repost], {
      eventStore,
      pool,
      addressLoader: addrLoader,
      relays
    });

    expect(Array.isArray(subs)).toBe(true);
    expect(subs.length).toBeGreaterThan(0);
  });
});
