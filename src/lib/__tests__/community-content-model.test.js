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
  CommunityWikiModel
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
