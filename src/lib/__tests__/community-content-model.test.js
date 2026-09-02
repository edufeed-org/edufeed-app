/**
 * Community Content Model Factory Tests
 *
 * Tests the generic createCommunityContentModel factory and concrete models.
 * Covers direct content, legacy 30222 shares, and NIP-18 reposts (kind 6/16).
 * Pure RxJS logic — no DOM, no network, no relays.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { of } from 'rxjs';
import {
  createCommunityContentModel,
  CommunityBoardModel,
  CommunityAMBResourceModel,
  CommunityCalendarEventModel,
  CommunityArticleModel,
  CommunityWikiModel,
  CommunityActivityModel
} from '$lib/models/community-content.js';

const COMMUNITY_PUBKEY = 'community123';

/**
 * Create a mock event
 * @param {Partial<{id: string, kind: number, pubkey: string, tags: string[][], created_at: number, content: string}>} overrides
 */
function mockEvent(overrides = {}) {
  return {
    id: overrides.id || Math.random().toString(36).slice(2),
    kind: overrides.kind || 30142,
    pubkey: overrides.pubkey || 'author1',
    tags: overrides.tags || [],
    created_at: overrides.created_at || Math.floor(Date.now() / 1000),
    content: overrides.content || ''
  };
}

/**
 * Create a mock EventStore that returns predefined observables for model() calls.
 * Now supports 4 streams: direct, legacy shares (30222), reposts (6/16), and all events.
 *
 * @param {Object} opts
 * @param {any[]} opts.direct - Direct community events (h-tagged)
 * @param {any[]} [opts.shares] - Legacy targeted publication events (kind 30222)
 * @param {any[]} [opts.reposts] - NIP-18 repost events (kind 6/16 with h-tag)
 * @param {any[]} opts.all - All events of the content kind
 */
function createMockEventStore({ direct = [], shares = [], reposts = [], all = [] }) {
  return {
    model: (/** @type {any} */ ModelClass, /** @type {any} */ filter) => {
      // Repost stream: kinds [6, 16] with #h
      if (filter.kinds?.includes(6) && filter.kinds?.includes(16) && filter['#h']) {
        return of(reposts);
      }
      // Legacy share stream: kind 30222 with #k
      if (filter.kinds?.includes(30222) || filter['#k']) {
        return of(shares);
      }
      // Direct stream: content kinds with #h
      if (filter['#h']) {
        return of(direct);
      }
      // All events stream (no #h, no #k)
      return of(all);
    }
  };
}

describe('createCommunityContentModel', () => {
  it('returns direct community content (h-tagged events)', () => {
    const event1 = mockEvent({ kind: 30142, tags: [['h', COMMUNITY_PUBKEY]] });
    const event2 = mockEvent({ kind: 30142, tags: [['h', COMMUNITY_PUBKEY]] });

    const store = createMockEventStore({
      direct: [event1, event2],
      shares: [],
      all: [event1, event2]
    });

    const Model = createCommunityContentModel([30142]);
    const model$ = Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store));

    /** @type {any} */
    let result;
    model$.subscribe((items) => (result = items));

    expect(result).toHaveLength(2);
    expect(result.map((/** @type {any} */ r) => r.id)).toContain(event1.id);
    expect(result.map((/** @type {any} */ r) => r.id)).toContain(event2.id);
  });

  it('resolves targeted publication references by event ID (e-tag)', () => {
    const referencedEvent = mockEvent({ id: 'event-abc', kind: 30142 });
    const shareEvent = mockEvent({
      kind: 30222,
      tags: [
        ['p', COMMUNITY_PUBKEY],
        ['e', 'event-abc'],
        ['k', '30142']
      ]
    });

    const store = createMockEventStore({
      direct: [],
      shares: [shareEvent],
      all: [referencedEvent]
    });

    const Model = createCommunityContentModel([30142]);
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('event-abc');
  });

  it('resolves targeted publication references by address (a-tag)', () => {
    const referencedEvent = mockEvent({
      id: 'event-xyz',
      kind: 30142,
      pubkey: 'author1',
      tags: [['d', 'my-resource']]
    });
    const shareEvent = mockEvent({
      kind: 30222,
      tags: [
        ['p', COMMUNITY_PUBKEY],
        ['a', '30142:author1:my-resource'],
        ['k', '30142']
      ]
    });

    const store = createMockEventStore({
      direct: [],
      shares: [shareEvent],
      all: [referencedEvent]
    });

    const Model = createCommunityContentModel([30142]);
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('event-xyz');
  });

  it('resolves NIP-18 repost references by event ID (e-tag)', () => {
    const referencedEvent = mockEvent({ id: 'reposted-event', kind: 30142 });
    const repostEvent = mockEvent({
      kind: 16,
      tags: [
        ['e', 'reposted-event'],
        ['k', '30142'],
        ['h', COMMUNITY_PUBKEY],
        ['p', 'author1']
      ],
      content: JSON.stringify(referencedEvent)
    });

    const store = createMockEventStore({
      direct: [],
      shares: [],
      reposts: [repostEvent],
      all: [referencedEvent]
    });

    const Model = createCommunityContentModel([30142]);
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('reposted-event');
  });

  it('attaches the repost time as _sharedAt so fresh shares of old events rank correctly', () => {
    const referencedEvent = mockEvent({ id: 'old-event', kind: 30142, created_at: 1000 });
    const repostEvent = mockEvent({
      kind: 16,
      created_at: 9000,
      tags: [
        ['e', 'old-event'],
        ['h', COMMUNITY_PUBKEY]
      ]
    });

    const store = createMockEventStore({
      direct: [],
      reposts: [repostEvent],
      all: [referencedEvent]
    });
    const Model = createCommunityContentModel([30142]);
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result[0]._sharedAt).toBe(9000);
    expect(result[0].created_at).toBe(1000);
  });

  it('keeps the NEWEST share time when an item is shared multiple times', () => {
    const referencedEvent = mockEvent({ id: 'old-event', kind: 30142, created_at: 1000 });
    const early = mockEvent({
      kind: 16,
      created_at: 5000,
      tags: [
        ['e', 'old-event'],
        ['h', COMMUNITY_PUBKEY]
      ]
    });
    const late = mockEvent({
      kind: 30222,
      created_at: 8000,
      tags: [
        ['e', 'old-event'],
        ['p', COMMUNITY_PUBKEY]
      ]
    });

    const store = createMockEventStore({
      direct: [],
      shares: [late],
      reposts: [early],
      all: [referencedEvent]
    });
    const Model = createCommunityContentModel([30142]);
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result[0]._sharedAt).toBe(8000);
  });

  it('resolves NIP-18 repost references by address (a-tag)', () => {
    const referencedEvent = mockEvent({
      id: 'reposted-addr',
      kind: 30142,
      pubkey: 'author1',
      tags: [['d', 'reposted-resource']]
    });
    const repostEvent = mockEvent({
      kind: 16,
      tags: [
        ['a', '30142:author1:reposted-resource'],
        ['e', 'reposted-addr'],
        ['k', '30142'],
        ['h', COMMUNITY_PUBKEY],
        ['p', 'author1']
      ],
      content: JSON.stringify(referencedEvent)
    });

    const store = createMockEventStore({
      direct: [],
      shares: [],
      reposts: [repostEvent],
      all: [referencedEvent]
    });

    const Model = createCommunityContentModel([30142]);
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('reposted-addr');
  });

  it('deduplicates — direct content takes priority over shares and reposts', () => {
    const event = mockEvent({
      id: 'dup-event',
      kind: 30142,
      tags: [
        ['h', COMMUNITY_PUBKEY],
        ['d', 'dup']
      ]
    });
    const shareEvent = mockEvent({
      kind: 30222,
      tags: [
        ['p', COMMUNITY_PUBKEY],
        ['e', 'dup-event'],
        ['k', '30142']
      ]
    });
    const repostEvent = mockEvent({
      kind: 16,
      tags: [
        ['e', 'dup-event'],
        ['k', '30142'],
        ['h', COMMUNITY_PUBKEY]
      ]
    });

    const store = createMockEventStore({
      direct: [event],
      shares: [shareEvent],
      reposts: [repostEvent],
      all: [event]
    });

    const Model = createCommunityContentModel([30142]);
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    // Should appear only once despite being direct, shared, and reposted
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('dup-event');
  });

  it('deduplicates — legacy shares take priority over reposts', () => {
    const event = mockEvent({ id: 'shared-reposted', kind: 30142 });
    const shareEvent = mockEvent({
      kind: 30222,
      tags: [
        ['p', COMMUNITY_PUBKEY],
        ['e', 'shared-reposted'],
        ['k', '30142']
      ]
    });
    const repostEvent = mockEvent({
      kind: 16,
      tags: [
        ['e', 'shared-reposted'],
        ['k', '30142'],
        ['h', COMMUNITY_PUBKEY]
      ]
    });

    const store = createMockEventStore({
      direct: [],
      shares: [shareEvent],
      reposts: [repostEvent],
      all: [event]
    });

    const Model = createCommunityContentModel([30142]);
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('shared-reposted');
  });

  it('applies optional transform function', () => {
    const event = mockEvent({ kind: 30142, tags: [['h', COMMUNITY_PUBKEY]] });

    const store = createMockEventStore({
      direct: [event],
      shares: [],
      all: [event]
    });

    const transform = (/** @type {any} */ e) => ({ ...e, transformed: true });
    const Model = createCommunityContentModel([30142], { transform });
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result).toHaveLength(1);
    expect(result[0].transformed).toBe(true);
    expect(result[0].id).toBe(event.id);
  });

  it('applies transform to shared (resolved) events too', () => {
    const referencedEvent = mockEvent({ id: 'shared-event', kind: 30142 });
    const shareEvent = mockEvent({
      kind: 30222,
      tags: [
        ['p', COMMUNITY_PUBKEY],
        ['e', 'shared-event'],
        ['k', '30142']
      ]
    });

    const store = createMockEventStore({
      direct: [],
      shares: [shareEvent],
      all: [referencedEvent]
    });

    const transform = (/** @type {any} */ e) => ({ ...e, transformed: true });
    const Model = createCommunityContentModel([30142], { transform });
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result).toHaveLength(1);
    expect(result[0].transformed).toBe(true);
  });

  it('applies transform to repost-resolved events', () => {
    const referencedEvent = mockEvent({ id: 'repost-resolved', kind: 30142 });
    const repostEvent = mockEvent({
      kind: 16,
      tags: [
        ['e', 'repost-resolved'],
        ['k', '30142'],
        ['h', COMMUNITY_PUBKEY]
      ]
    });

    const store = createMockEventStore({
      direct: [],
      shares: [],
      reposts: [repostEvent],
      all: [referencedEvent]
    });

    const transform = (/** @type {any} */ e) => ({ ...e, transformed: true });
    const Model = createCommunityContentModel([30142], { transform });
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result).toHaveLength(1);
    expect(result[0].transformed).toBe(true);
    expect(result[0].id).toBe('repost-resolved');
  });

  it('returns empty array when no content exists', () => {
    const store = createMockEventStore({
      direct: [],
      shares: [],
      all: []
    });

    const Model = createCommunityContentModel([30142]);
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result).toEqual([]);
  });

  it('ignores share events whose references are not in the store', () => {
    const shareEvent = mockEvent({
      kind: 30222,
      tags: [
        ['p', COMMUNITY_PUBKEY],
        ['e', 'nonexistent-id'],
        ['k', '30142']
      ]
    });

    const store = createMockEventStore({
      direct: [],
      shares: [shareEvent],
      all: [] // referenced event not loaded
    });

    const Model = createCommunityContentModel([30142]);
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result).toEqual([]);
  });

  it('ignores repost events whose references are not in the store', () => {
    const repostEvent = mockEvent({
      kind: 16,
      tags: [
        ['e', 'nonexistent-repost'],
        ['k', '30142'],
        ['h', COMMUNITY_PUBKEY]
      ]
    });

    const store = createMockEventStore({
      direct: [],
      shares: [],
      reposts: [repostEvent],
      all: []
    });

    const Model = createCommunityContentModel([30142]);
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result).toEqual([]);
  });
});

describe('CommunityBoardModel', () => {
  it('works with kind 30301 board events', () => {
    const board = mockEvent({
      kind: 30301,
      tags: [
        ['h', COMMUNITY_PUBKEY],
        ['d', 'my-board'],
        ['title', 'Sprint Board']
      ]
    });

    const store = createMockEventStore({
      direct: [board],
      shares: [],
      all: [board]
    });

    // Override mock store to handle kind 30301 filters correctly
    store.model = (/** @type {any} */ ModelClass, /** @type {any} */ filter) => {
      if (filter.kinds?.includes(6)) return of([]);
      if (filter.kinds?.includes(30222)) return of([]);
      if (filter['#h']) return of([board]);
      return of([board]);
    };

    /** @type {any} */
    let result;
    CommunityBoardModel(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe(
      (items) => (result = items)
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(board.id);
  });

  it('resolves board targeted publications', () => {
    const board = mockEvent({
      kind: 30301,
      pubkey: 'boardauthor',
      tags: [['d', 'sprint-1']]
    });
    const share = mockEvent({
      kind: 30222,
      tags: [
        ['p', COMMUNITY_PUBKEY],
        ['a', '30301:boardauthor:sprint-1'],
        ['k', '30301']
      ]
    });

    const store = {
      model: (/** @type {any} */ ModelClass, /** @type {any} */ filter) => {
        if (filter.kinds?.includes(6)) return of([]);
        if (filter.kinds?.includes(30222)) return of([share]);
        if (filter['#h']) return of([]);
        return of([board]);
      }
    };

    /** @type {any} */
    let result;
    CommunityBoardModel(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe(
      (items) => (result = items)
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(board.id);
  });
});

describe('CommunityAMBResourceModel', () => {
  it('returns formatted AMB resources for kind 30142', () => {
    const resource = mockEvent({
      kind: 30142,
      tags: [
        ['h', COMMUNITY_PUBKEY],
        ['d', 'res-1'],
        ['name', 'Test Resource']
      ]
    });

    const store = createMockEventStore({
      direct: [resource],
      shares: [],
      all: [resource]
    });

    /** @type {any} */
    let result;
    CommunityAMBResourceModel(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe(
      (items) => (result = items)
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(resource.id);
    // formatAMBResource adds 'name' field from tags
    expect(result[0]).toHaveProperty('name');
  });

  it('resolves shared AMB resources via targeted publications', () => {
    const resource = mockEvent({
      id: 'amb-shared',
      kind: 30142,
      pubkey: 'author1',
      tags: [['d', 'shared-res']]
    });
    const share = mockEvent({
      kind: 30222,
      tags: [
        ['p', COMMUNITY_PUBKEY],
        ['a', '30142:author1:shared-res'],
        ['k', '30142']
      ]
    });

    const store = createMockEventStore({
      direct: [],
      shares: [share],
      all: [resource]
    });

    /** @type {any} */
    let result;
    CommunityAMBResourceModel(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe(
      (items) => (result = items)
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('amb-shared');
  });

  it('resolves AMB resources via NIP-18 reposts', () => {
    const resource = mockEvent({
      id: 'amb-reposted',
      kind: 30142,
      pubkey: 'author1',
      tags: [['d', 'reposted-res']]
    });
    const repost = mockEvent({
      kind: 16,
      tags: [
        ['e', 'amb-reposted'],
        ['a', '30142:author1:reposted-res'],
        ['k', '30142'],
        ['h', COMMUNITY_PUBKEY],
        ['p', 'author1']
      ]
    });

    const store = createMockEventStore({
      direct: [],
      shares: [],
      reposts: [repost],
      all: [resource]
    });

    /** @type {any} */
    let result;
    CommunityAMBResourceModel(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe(
      (items) => (result = items)
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('amb-reposted');
  });
});

describe('CommunityCalendarEventModel', () => {
  it('returns formatted calendar events for kinds 31922 and 31923', () => {
    const dateEvent = mockEvent({
      kind: 31922,
      tags: [
        ['h', COMMUNITY_PUBKEY],
        ['d', 'cal-1'],
        ['title', 'All Day Event'],
        ['start', '2025-01-15']
      ]
    });
    const timeEvent = mockEvent({
      kind: 31923,
      tags: [
        ['h', COMMUNITY_PUBKEY],
        ['d', 'cal-2'],
        ['title', 'Timed Event'],
        ['start', '1705334400']
      ]
    });

    const store = {
      model: (/** @type {any} */ ModelClass, /** @type {any} */ filter) => {
        if (filter.kinds?.includes(6)) return of([]);
        if (filter.kinds?.includes(30222)) return of([]);
        if (filter['#h']) return of([dateEvent, timeEvent]);
        return of([dateEvent, timeEvent]);
      }
    };

    /** @type {any} */
    let result;
    CommunityCalendarEventModel(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe(
      (items) => (result = items)
    );

    expect(result).toHaveLength(2);
    // getCalendarEventMetadata adds 'title' field
    expect(result.map((/** @type {any} */ r) => r.title)).toContain('All Day Event');
    expect(result.map((/** @type {any} */ r) => r.title)).toContain('Timed Event');
  });

  it('resolves shared calendar events via targeted publications', () => {
    const calEvent = mockEvent({
      id: 'cal-shared',
      kind: 31923,
      pubkey: 'author1',
      tags: [
        ['d', 'shared-cal'],
        ['title', 'Shared Event'],
        ['start', '1705334400']
      ]
    });
    const share = mockEvent({
      kind: 30222,
      tags: [
        ['p', COMMUNITY_PUBKEY],
        ['e', 'cal-shared'],
        ['k', '31923']
      ]
    });

    const store = {
      model: (/** @type {any} */ ModelClass, /** @type {any} */ filter) => {
        if (filter.kinds?.includes(6)) return of([]);
        if (filter.kinds?.includes(30222)) return of([share]);
        if (filter['#h']) return of([]);
        return of([calEvent]);
      }
    };

    /** @type {any} */
    let result;
    CommunityCalendarEventModel(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe(
      (items) => (result = items)
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('cal-shared');
  });
});

describe('CommunityArticleModel', () => {
  it('returns articles for kind 30023 without transform', () => {
    const article = mockEvent({
      kind: 30023,
      tags: [
        ['h', COMMUNITY_PUBKEY],
        ['d', 'article-1'],
        ['title', 'My Article']
      ],
      content: '# Hello World'
    });

    const store = {
      model: (/** @type {any} */ ModelClass, /** @type {any} */ filter) => {
        if (filter.kinds?.includes(6)) return of([]);
        if (filter.kinds?.includes(30222)) return of([]);
        if (filter['#h']) return of([article]);
        return of([article]);
      }
    };

    /** @type {any} */
    let result;
    CommunityArticleModel(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe(
      (items) => (result = items)
    );

    expect(result).toHaveLength(1);
    // No transform — raw event returned
    expect(result[0].id).toBe(article.id);
    expect(result[0].content).toBe('# Hello World');
  });

  it('resolves shared articles via targeted publications', () => {
    const article = mockEvent({
      id: 'article-shared',
      kind: 30023,
      pubkey: 'author1',
      tags: [['d', 'shared-art']]
    });
    const share = mockEvent({
      kind: 30222,
      tags: [
        ['p', COMMUNITY_PUBKEY],
        ['a', '30023:author1:shared-art'],
        ['k', '30023']
      ]
    });

    const store = {
      model: (/** @type {any} */ ModelClass, /** @type {any} */ filter) => {
        if (filter.kinds?.includes(6)) return of([]);
        if (filter.kinds?.includes(30222)) return of([share]);
        if (filter['#h']) return of([]);
        return of([article]);
      }
    };

    /** @type {any} */
    let result;
    CommunityArticleModel(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe(
      (items) => (result = items)
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('article-shared');
  });
});

describe('CommunityWikiModel', () => {
  it('returns wiki events for kind 30818', () => {
    const wiki = mockEvent({
      kind: 30818,
      tags: [
        ['h', COMMUNITY_PUBKEY],
        ['d', 'test-topic'],
        ['title', 'Test Wiki']
      ],
      content: '# Test Wiki Content'
    });

    const store = {
      model: (/** @type {any} */ ModelClass, /** @type {any} */ filter) => {
        if (filter.kinds?.includes(6)) return of([]);
        if (filter.kinds?.includes(30222)) return of([]);
        if (filter['#h']) return of([wiki]);
        return of([wiki]);
      }
    };

    /** @type {any} */
    let result;
    CommunityWikiModel(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe(
      (items) => (result = items)
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(wiki.id);
    expect(result[0].content).toBe('# Test Wiki Content');
  });

  it('resolves shared wikis via targeted publications', () => {
    const wiki = mockEvent({
      id: 'wiki-shared',
      kind: 30818,
      pubkey: 'author1',
      tags: [['d', 'shared-topic']]
    });
    const share = mockEvent({
      kind: 30222,
      tags: [
        ['p', COMMUNITY_PUBKEY],
        ['a', '30818:author1:shared-topic'],
        ['k', '30818']
      ]
    });

    const store = {
      model: (/** @type {any} */ ModelClass, /** @type {any} */ filter) => {
        if (filter.kinds?.includes(6)) return of([]);
        if (filter.kinds?.includes(30222)) return of([share]);
        if (filter['#h']) return of([]);
        return of([wiki]);
      }
    };

    /** @type {any} */
    let result;
    CommunityWikiModel(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe(
      (items) => (result = items)
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('wiki-shared');
  });

  it('resolves shared wikis via NIP-18 reposts', () => {
    const wiki = mockEvent({
      id: 'wiki-reposted',
      kind: 30818,
      pubkey: 'author1',
      tags: [['d', 'reposted-topic']]
    });
    const repost = mockEvent({
      kind: 16,
      tags: [
        ['e', 'wiki-reposted'],
        ['a', '30818:author1:reposted-topic'],
        ['k', '30818'],
        ['h', COMMUNITY_PUBKEY],
        ['p', 'author1']
      ]
    });

    const store = {
      model: (/** @type {any} */ ModelClass, /** @type {any} */ filter) => {
        if (filter.kinds?.includes(6)) return of([repost]);
        if (filter.kinds?.includes(30222)) return of([]);
        if (filter['#h']) return of([]);
        return of([wiki]);
      }
    };

    /** @type {any} */
    let result;
    CommunityWikiModel(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe(
      (items) => (result = items)
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('wiki-reposted');
  });

  it('combines direct and shared wikis with deduplication', () => {
    const wiki = mockEvent({
      id: 'wiki-both',
      kind: 30818,
      tags: [
        ['h', COMMUNITY_PUBKEY],
        ['d', 'dup-topic']
      ]
    });
    const share = mockEvent({
      kind: 30222,
      tags: [
        ['p', COMMUNITY_PUBKEY],
        ['e', 'wiki-both'],
        ['k', '30818']
      ]
    });

    const store = {
      model: (/** @type {any} */ ModelClass, /** @type {any} */ filter) => {
        if (filter.kinds?.includes(6)) return of([]);
        if (filter.kinds?.includes(30222)) return of([share]);
        if (filter['#h']) return of([wiki]);
        return of([wiki]);
      }
    };

    /** @type {any} */
    let result;
    CommunityWikiModel(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe(
      (items) => (result = items)
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('wiki-both');
  });
});

describe('_allSharers collection', () => {
  it('collects multiple legacy sharers into _allSharers', () => {
    const event = mockEvent({ id: 'multi-shared', kind: 30142 });
    const share1 = mockEvent({
      kind: 30222,
      pubkey: 'sharer1',
      tags: [
        ['p', COMMUNITY_PUBKEY],
        ['e', 'multi-shared'],
        ['k', '30142']
      ]
    });
    const share2 = mockEvent({
      kind: 30222,
      pubkey: 'sharer2',
      tags: [
        ['p', COMMUNITY_PUBKEY],
        ['e', 'multi-shared'],
        ['k', '30142']
      ]
    });

    const store = createMockEventStore({
      direct: [],
      shares: [share1, share2],
      all: [event]
    });

    const Model = createCommunityContentModel([30142]);
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result).toHaveLength(1);
    expect(result[0]._allSharers).toEqual(['sharer1', 'sharer2']);
    expect(result[0]._sharedBy).toBe('sharer1');
  });

  it('collects multiple repost sharers into _allSharers', () => {
    const event = mockEvent({ id: 'multi-reposted', kind: 30142 });
    const repost1 = mockEvent({
      kind: 16,
      pubkey: 'reposter1',
      tags: [
        ['e', 'multi-reposted'],
        ['k', '30142'],
        ['h', COMMUNITY_PUBKEY]
      ]
    });
    const repost2 = mockEvent({
      kind: 16,
      pubkey: 'reposter2',
      tags: [
        ['e', 'multi-reposted'],
        ['k', '30142'],
        ['h', COMMUNITY_PUBKEY]
      ]
    });

    const store = createMockEventStore({
      direct: [],
      shares: [],
      reposts: [repost1, repost2],
      all: [event]
    });

    const Model = createCommunityContentModel([30142]);
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result).toHaveLength(1);
    expect(result[0]._allSharers).toEqual(['reposter1', 'reposter2']);
    expect(result[0]._sharedBy).toBe('reposter1');
  });

  it('collects mixed share + repost into _allSharers', () => {
    const event = mockEvent({ id: 'mixed-shared', kind: 30142 });
    const share = mockEvent({
      kind: 30222,
      pubkey: 'legacy-sharer',
      tags: [
        ['p', COMMUNITY_PUBKEY],
        ['e', 'mixed-shared'],
        ['k', '30142']
      ]
    });
    const repost = mockEvent({
      kind: 16,
      pubkey: 'reposter',
      tags: [
        ['e', 'mixed-shared'],
        ['k', '30142'],
        ['h', COMMUNITY_PUBKEY]
      ]
    });

    const store = createMockEventStore({
      direct: [],
      shares: [share],
      reposts: [repost],
      all: [event]
    });

    const Model = createCommunityContentModel([30142]);
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result).toHaveLength(1);
    expect(result[0]._allSharers).toEqual(['legacy-sharer', 'reposter']);
    expect(result[0]._sharedBy).toBe('legacy-sharer');
  });

  it('collects sharers on direct event when also shared/reposted', () => {
    const event = mockEvent({
      id: 'direct-and-shared',
      kind: 30142,
      tags: [['h', COMMUNITY_PUBKEY]]
    });
    const share = mockEvent({
      kind: 30222,
      pubkey: 'sharer-of-direct',
      tags: [
        ['p', COMMUNITY_PUBKEY],
        ['e', 'direct-and-shared'],
        ['k', '30142']
      ]
    });

    const store = createMockEventStore({
      direct: [event],
      shares: [share],
      all: [event]
    });

    const Model = createCommunityContentModel([30142]);
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result).toHaveLength(1);
    expect(result[0]._allSharers).toEqual(['sharer-of-direct']);
    // Direct event should NOT have _sharedBy (it was posted directly)
    expect(result[0]._sharedBy).toBeUndefined();
  });

  it('deduplicates pubkeys in _allSharers', () => {
    const event = mockEvent({ id: 'dedup-sharers', kind: 30142 });
    const share = mockEvent({
      kind: 30222,
      pubkey: 'same-person',
      tags: [
        ['p', COMMUNITY_PUBKEY],
        ['e', 'dedup-sharers'],
        ['k', '30142']
      ]
    });
    const repost = mockEvent({
      kind: 16,
      pubkey: 'same-person',
      tags: [
        ['e', 'dedup-sharers'],
        ['k', '30142'],
        ['h', COMMUNITY_PUBKEY]
      ]
    });

    const store = createMockEventStore({
      direct: [],
      shares: [share],
      reposts: [repost],
      all: [event]
    });

    const Model = createCommunityContentModel([30142]);
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result).toHaveLength(1);
    expect(result[0]._allSharers).toEqual(['same-person']);
  });

  it('single sharer still gets _allSharers array', () => {
    const event = mockEvent({ id: 'single-shared', kind: 30142 });
    const share = mockEvent({
      kind: 30222,
      pubkey: 'lone-sharer',
      tags: [
        ['p', COMMUNITY_PUBKEY],
        ['e', 'single-shared'],
        ['k', '30142']
      ]
    });

    const store = createMockEventStore({
      direct: [],
      shares: [share],
      all: [event]
    });

    const Model = createCommunityContentModel([30142]);
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result).toHaveLength(1);
    expect(result[0]._allSharers).toEqual(['lone-sharer']);
    expect(result[0]._sharedBy).toBe('lone-sharer');
  });
});

describe('activity ordering (share-date sort)', () => {
  /** @param {string} id @param {number} createdAt */
  const repostOf = (id, createdAt) =>
    mockEvent({
      kind: 16,
      created_at: createdAt,
      tags: [
        ['e', id],
        ['h', COMMUNITY_PUBKEY]
      ]
    });

  it('orders items by share time / publish time, newest activity first', () => {
    const directEvent = mockEvent({
      id: 'direct-mid',
      kind: 30142,
      created_at: 7000,
      tags: [['h', COMMUNITY_PUBKEY]]
    });
    const oldEventA = mockEvent({ id: 'old-a', kind: 30142, created_at: 1000 });
    const oldEventB = mockEvent({ id: 'old-b', kind: 30142, created_at: 2000 });

    const store = createMockEventStore({
      direct: [directEvent],
      reposts: [repostOf('old-a', 9000), repostOf('old-b', 3000)],
      all: [directEvent, oldEventA, oldEventB]
    });

    const Model = createCommunityContentModel([30142]);
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result.map((/** @type {any} */ r) => r.id)).toEqual(['old-a', 'direct-mid', 'old-b']);
  });

  it('ranks a direct event shared again by its newest share time', () => {
    const oldDirect = mockEvent({
      id: 'old-direct',
      kind: 30142,
      created_at: 1000,
      tags: [['h', COMMUNITY_PUBKEY]]
    });
    const newerDirect = mockEvent({
      id: 'newer-direct',
      kind: 30142,
      created_at: 5000,
      tags: [['h', COMMUNITY_PUBKEY]]
    });

    const store = createMockEventStore({
      direct: [newerDirect, oldDirect],
      reposts: [repostOf('old-direct', 9000)],
      all: [newerDirect, oldDirect]
    });

    const Model = createCommunityContentModel([30142]);
    /** @type {any} */
    let result;
    Model(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe((items) => (result = items));

    expect(result.map((/** @type {any} */ r) => r.id)).toEqual(['old-direct', 'newer-direct']);
  });

  it('sorts by source-event timestamps even when the transform drops created_at', () => {
    const directCal = mockEvent({
      id: 'cal-direct',
      kind: 31923,
      created_at: 7000,
      tags: [
        ['h', COMMUNITY_PUBKEY],
        ['d', 'direct-cal'],
        ['title', 'Direct'],
        ['start', '1705334400']
      ]
    });
    const oldCal = mockEvent({
      id: 'cal-old',
      kind: 31923,
      created_at: 1000,
      pubkey: 'author1',
      tags: [
        ['d', 'old-cal'],
        ['title', 'Old but freshly shared'],
        ['start', '1705334400']
      ]
    });

    const store = createMockEventStore({
      direct: [directCal],
      reposts: [repostOf('cal-old', 9000)],
      all: [directCal, oldCal]
    });

    /** @type {any} */
    let result;
    CommunityCalendarEventModel(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe(
      (items) => (result = items)
    );

    // getCalendarEventMetadata exposes createdAt (camelCase), not created_at —
    // ordering must not depend on the transformed item's shape.
    expect(result.map((/** @type {any} */ r) => r.id)).toEqual(['cal-old', 'cal-direct']);
  });
});

describe('CommunityActivityModel', () => {
  it('returns events across multiple kinds', () => {
    const amb = mockEvent({ kind: 30142, tags: [['h', COMMUNITY_PUBKEY]] });
    const cal = mockEvent({ kind: 31923, tags: [['h', COMMUNITY_PUBKEY]] });
    const article = mockEvent({ kind: 30023, tags: [['h', COMMUNITY_PUBKEY]] });

    const store = {
      model: (/** @type {any} */ ModelClass, /** @type {any} */ filter) => {
        if (filter.kinds?.includes(6)) return of([]);
        if (filter.kinds?.includes(30222)) return of([]);
        if (filter['#h']) return of([amb, cal, article]);
        return of([amb, cal, article]);
      }
    };

    /** @type {any} */
    let result;
    CommunityActivityModel(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe(
      (items) => (result = items)
    );

    expect(result).toHaveLength(3);
    const kinds = result.map((/** @type {any} */ r) => r.kind);
    expect(kinds).toContain(30142);
    expect(kinds).toContain(31923);
    expect(kinds).toContain(30023);
  });

  it('deduplicates across kinds — same event in direct + repost', () => {
    const event = mockEvent({
      id: 'activity-dup',
      kind: 30142,
      tags: [['h', COMMUNITY_PUBKEY]]
    });
    const repost = mockEvent({
      kind: 16,
      tags: [
        ['e', 'activity-dup'],
        ['k', '30142'],
        ['h', COMMUNITY_PUBKEY]
      ]
    });

    const store = {
      model: (/** @type {any} */ ModelClass, /** @type {any} */ filter) => {
        if (filter.kinds?.includes(6)) return of([repost]);
        if (filter.kinds?.includes(30222)) return of([]);
        if (filter['#h']) return of([event]);
        return of([event]);
      }
    };

    /** @type {any} */
    let result;
    CommunityActivityModel(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe(
      (items) => (result = items)
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('activity-dup');
  });
});
