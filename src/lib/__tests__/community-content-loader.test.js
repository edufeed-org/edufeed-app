/**
 * Community Content Loader Factory Tests
 *
 * Tests createCommunityContentLoader — the generic factory that extracts
 * the shared loading pattern: direct content, legacy 30222, NIP-18 reposts,
 * and reference resolution.
 *
 * Uses mocked modules for relay/store infrastructure.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Subject, of } from 'rxjs';

// Mock infrastructure modules (use $lib paths, not relative)
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => {
  const modelSubject = new Subject();
  return {
    pool: {
      request: vi.fn(() => of()),
      subscription: vi.fn(() => ({
        pipe: vi.fn(() => ({
          subscribe: vi.fn(() => ({ unsubscribe: vi.fn() }))
        }))
      }))
    },
    eventStore: {
      model: vi.fn(() => modelSubject),
      add: vi.fn(),
      getReplaceable: vi.fn(() => null)
    }
  };
});

vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: vi.fn(() => () => of())
}));

vi.mock('applesauce-core/models', () => ({
  TimelineModel: 'TimelineModel'
}));

vi.mock('applesauce-core/helpers', () => ({
  getTagValue: vi.fn((event, tag) => {
    const found = event.tags?.find((/** @type {any[]} */ t) => t[0] === tag);
    return found?.[1] || null;
  })
}));

vi.mock('applesauce-common/helpers', async (importOriginal) => {
  const orig = /** @type {any} */ (await importOriginal());
  return {
    ...orig,
    getEmbededSharedEvent: vi.fn((event) => {
      if (!event.content) return undefined;
      try {
        const parsed = JSON.parse(event.content);
        return parsed?.id && parsed?.kind ? parsed : undefined;
      } catch {
        return undefined;
      }
    }),
    getSharedEventPointer: vi.fn((event) => {
      const eTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'e');
      if (!eTag) return undefined;
      return { id: eTag[1], relays: eTag[2] ? [eTag[2]] : [] };
    }),
    getSharedAddressPointer: vi.fn((event) => {
      const aTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'a');
      if (!aTag) return undefined;
      const parts = aTag[1].split(':');
      if (parts.length < 3) return undefined;
      return { kind: parseInt(parts[0]), pubkey: parts[1], identifier: parts.slice(2).join(':') };
    })
  };
});

vi.mock('$lib/helpers/nostrUtils.js', () => ({
  parseAddressPointerFromATag: vi.fn((aTag) => {
    const parts = aTag.split(':');
    if (parts.length >= 3) {
      return {
        kind: parseInt(parts[0]),
        pubkey: parts[1],
        identifier: parts.slice(2).join(':')
      };
    }
    return null;
  })
}));

vi.mock('$lib/loaders/base.js', async () => {
  const { createTimelineLoader } = /** @type {any} */ (await import('applesauce-loaders/loaders'));
  return {
    timedPool: vi.fn(),
    addressLoader: vi.fn(() => ({ subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) })),
    createCachedTimelineLoader: (
      /** @type {string[]} */ relays,
      /** @type {any} */ filter,
      /** @type {any} */ opts = {}
    ) => createTimelineLoader(vi.fn(), relays, filter, { eventStore: {}, ...opts })
  };
});

vi.mock('$lib/loaders/targeted-publications.js', () => ({
  communityTargetedPublicationsLoader: vi.fn(() => () => ({
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() }))
  }))
}));

vi.mock('$lib/helpers/communityRelays.js', () => ({
  getCommunityGlobalRelays: vi.fn(() => [])
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: vi.fn(() => [
    'wss://lookup1.example.com',
    'wss://lookup2.example.com',
    'wss://relay1.example.com'
  ]),
  getCommunikeyRelays: vi.fn(() => ['wss://communikey1.example.com']),
  getEventLoaderLookupRelays: () => []
}));

// Import after mocks
const { createCommunityContentLoader } = await import('$lib/loaders/community-content-loader.js');
const { createTimelineLoader } = await import('applesauce-loaders/loaders');
const { communityTargetedPublicationsLoader } = await import(
  '$lib/loaders/targeted-publications.js'
);
const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');
const { addressLoader } = await import('$lib/loaders/base.js');
const { getAllLookupRelays: _getAllLookupRelays } = await import('$lib/helpers/relay-helper.js');
const { pool } = await import('$lib/stores/nostr-infrastructure.svelte');

const COMMUNITY_PK = 'abc123def456';

describe('createCommunityContentLoader', () => {
  const getRelays = vi.fn(() => ['wss://relay1.example.com', 'wss://relay2.example.com']);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a function', () => {
    const loader = createCommunityContentLoader([30142], getRelays);
    expect(typeof loader).toBe('function');
  });

  it('returns early with empty subscriptions when communityPubkey is empty', () => {
    const loader = createCommunityContentLoader([30142], getRelays);
    const result = loader('');

    expect(result.subscriptions.size).toBe(0);
    expect(typeof result.cleanup).toBe('function');
    expect(createTimelineLoader).not.toHaveBeenCalled();
    expect(communityTargetedPublicationsLoader).not.toHaveBeenCalled();
  });

  it('creates direct content loader with correct kinds and relays', () => {
    const loader = createCommunityContentLoader([30142], getRelays);
    loader(COMMUNITY_PK);

    expect(createTimelineLoader).toHaveBeenCalledWith(
      expect.any(Function),
      ['wss://relay1.example.com', 'wss://relay2.example.com'],
      { kinds: [30142], '#h': [COMMUNITY_PK] },
      expect.objectContaining({ eventStore: expect.any(Object), limit: 50 })
    );
  });

  it('creates repost loader for kind 6/16 with h-tag', () => {
    const loader = createCommunityContentLoader([30142], getRelays);
    loader(COMMUNITY_PK);

    // Should create a loader for NIP-18 reposts targeting this community
    expect(createTimelineLoader).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Array),
      { kinds: [6, 16], '#h': [COMMUNITY_PK] },
      expect.objectContaining({ eventStore: expect.any(Object), limit: 50 })
    );
  });

  it('uses broad relay set (getAllLookupRelays + community relays) for repost loader', () => {
    const loader = createCommunityContentLoader([30142], getRelays);
    loader(COMMUNITY_PK);

    // Find the repost loader call (kind 6/16 filter)
    const repostCall = /** @type {any} */ (createTimelineLoader).mock.calls.find(
      (/** @type {any[]} */ call) => {
        const filter = call[2];
        return filter.kinds?.includes(6) && filter.kinds?.includes(16);
      }
    );
    expect(repostCall).toBeDefined();

    const repostRelays = repostCall[1];
    // Must include getAllLookupRelays() relays (broad discovery)
    expect(repostRelays).toContain('wss://lookup1.example.com');
    expect(repostRelays).toContain('wss://lookup2.example.com');
    // Must NOT be limited to just the content-type relays
    expect(repostRelays.length).toBeGreaterThan(getRelays().length);
  });

  // Regression: previously the direct h-tag-scoped content filter ran through
  // `filterFn: applyCuratedFilter`, which injected an `authors:` restriction
  // derived from curated/WoT pubkey lists. That excluded community members'
  // content from the community view at the relay layer — even though the
  // matching model has no author restriction. Visiting the author's profile
  // (which has no curated filter) brought events into EventStore and the model
  // would then surface them, masking the loader bug. h-tag scoping IS the
  // curation; no additional author filtering should be applied here.
  it('does NOT add an authors filter to the direct h-tag-scoped content query', () => {
    const loader = createCommunityContentLoader([30023], getRelays);
    loader(COMMUNITY_PK);

    const directCall = /** @type {any} */ (createTimelineLoader).mock.calls.find(
      (/** @type {any[]} */ call) =>
        Array.isArray(call[2]?.kinds) &&
        call[2].kinds.includes(30023) &&
        Array.isArray(call[2]['#h'])
    );
    expect(directCall).toBeDefined();
    expect(directCall[2]).toEqual({ kinds: [30023], '#h': [COMMUNITY_PK] });
    expect(directCall[2].authors).toBeUndefined();
  });

  it('creates targeted publications loader for the community', () => {
    const loader = createCommunityContentLoader([30301], getRelays);
    loader(COMMUNITY_PK);

    expect(communityTargetedPublicationsLoader).toHaveBeenCalledWith(COMMUNITY_PK, [30301]);
  });

  it('subscribes to EventStore model for legacy 30222 reference resolution', () => {
    const loader = createCommunityContentLoader([30023], getRelays);
    loader(COMMUNITY_PK);

    expect(eventStore.model).toHaveBeenCalledWith('TimelineModel', {
      kinds: [30222],
      '#p': [COMMUNITY_PK],
      '#k': ['30023'],
      limit: 100
    });
  });

  it('subscribes to EventStore model for repost reference resolution', () => {
    const loader = createCommunityContentLoader([30142], getRelays);
    loader(COMMUNITY_PK);

    expect(eventStore.model).toHaveBeenCalledWith('TimelineModel', {
      kinds: [6, 16],
      '#h': [COMMUNITY_PK],
      limit: 100
    });
  });

  it('creates 5 subscriptions (direct, reposts, targeted, legacyReferenced, repostReferenced)', () => {
    const loader = createCommunityContentLoader([30142], getRelays);
    const { subscriptions } = loader(COMMUNITY_PK);

    expect(subscriptions.has('direct')).toBe(true);
    expect(subscriptions.has('reposts')).toBe(true);
    expect(subscriptions.has('targetedPublications')).toBe(true);
    expect(subscriptions.has('legacyReferenced')).toBe(true);
    expect(subscriptions.has('repostReferenced')).toBe(true);
    expect(subscriptions.size).toBe(5);
  });

  it('cleanup unsubscribes all subscriptions and clears the map', () => {
    const mockUnsub = vi.fn();

    /** @type {any} */ (createTimelineLoader).mockReturnValue(() => ({
      subscribe: () => ({ unsubscribe: mockUnsub })
    }));

    const loader = createCommunityContentLoader([30142], getRelays);
    const { subscriptions, cleanup } = loader(COMMUNITY_PK);

    const sizeBefore = subscriptions.size;
    expect(sizeBefore).toBeGreaterThan(0);

    cleanup();

    expect(subscriptions.size).toBe(0);
  });

  it('works with multiple kinds', () => {
    const loader = createCommunityContentLoader([31922, 31923], getRelays);
    loader(COMMUNITY_PK);

    expect(createTimelineLoader).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Array),
      expect.objectContaining({ kinds: [31922, 31923] }),
      expect.any(Object)
    );

    expect(communityTargetedPublicationsLoader).toHaveBeenCalledWith(COMMUNITY_PK, [31922, 31923]);

    expect(eventStore.model).toHaveBeenCalledWith(
      'TimelineModel',
      expect.objectContaining({
        '#k': ['31922', '31923']
      })
    );
  });

  it('uses pool.request for e-tag and addressLoader for a-tag when resolving repost references', () => {
    // Set up model mock to emit repost events on the second call (repost watcher)
    const legacySubject = new Subject();
    const repostSubject = new Subject();
    let modelCallCount = 0;
    /** @type {any} */ (eventStore.model).mockImplementation(() => {
      modelCallCount++;
      // First model call = legacy 30222 watcher, second = repost watcher
      return modelCallCount === 1 ? legacySubject : repostSubject;
    });

    const loader = createCommunityContentLoader([30142], getRelays);
    loader(COMMUNITY_PK);

    // Emit a repost event that references via both e-tag and a-tag
    repostSubject.next([
      {
        id: 'repost1',
        kind: 16,
        tags: [
          ['e', 'referenced-event-id'],
          ['a', '30142:author1:wiki-slug'],
          ['h', COMMUNITY_PK]
        ],
        content: ''
      }
    ]);

    // e-tag resolved via pool.request (one-shot, no deduplication)
    expect(pool.request).toHaveBeenCalledWith(
      expect.any(Array),
      [{ ids: ['referenced-event-id'] }],
      expect.any(Object)
    );

    // a-tag resolved via addressLoader
    expect(addressLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 30142,
        pubkey: 'author1',
        identifier: 'wiki-slug'
      })
    );
  });

  it('uses pool.request and addressLoader when resolving legacy 30222 references', () => {
    const legacySubject = new Subject();
    const repostSubject = new Subject();
    let modelCallCount = 0;
    /** @type {any} */ (eventStore.model).mockImplementation(() => {
      modelCallCount++;
      return modelCallCount === 1 ? legacySubject : repostSubject;
    });

    const loader = createCommunityContentLoader([30142], getRelays);
    loader(COMMUNITY_PK);

    // Emit a legacy share event that references via both e-tag and a-tag
    legacySubject.next([
      {
        id: 'share1',
        kind: 30222,
        tags: [
          ['e', 'legacy-ref-id'],
          ['a', '30142:author2:article-slug'],
          ['p', COMMUNITY_PK],
          ['k', '30142']
        ],
        content: ''
      }
    ]);

    // e-tag resolved via pool.request (one-shot)
    expect(pool.request).toHaveBeenCalledWith(
      expect.any(Array),
      [{ ids: ['legacy-ref-id'] }],
      expect.any(Object)
    );

    // a-tag resolved via addressLoader
    expect(addressLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 30142,
        pubkey: 'author2',
        identifier: 'article-slug'
      })
    );
  });

  it('does not use SvelteSet for internal tracking (uses plain Set)', () => {
    // Verifies Pattern C from MEMORY.md:
    // SvelteSet would throw in node env without Svelte runtime
    const loader = createCommunityContentLoader([30142], getRelays);
    const { subscriptions } = loader(COMMUNITY_PK);

    expect(subscriptions).toBeInstanceOf(Map);
  });
});
