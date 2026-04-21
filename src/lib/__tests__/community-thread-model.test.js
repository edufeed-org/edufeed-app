/**
 * Community Thread Model Tests
 *
 * Tests CommunityThreadModel (kind 11 forum threads).
 * Pure RxJS logic — no DOM, no network, no relays.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { of } from 'rxjs';
import { CommunityThreadModel } from '$lib/models/community-content.js';

const COMMUNITY_PUBKEY = 'community123';

/**
 * Create a mock event
 * @param {Partial<{id: string, kind: number, pubkey: string, tags: string[][], created_at: number, content: string}>} overrides
 */
function mockEvent(overrides = {}) {
  return {
    id: overrides.id || Math.random().toString(36).slice(2),
    kind: overrides.kind || 11,
    pubkey: overrides.pubkey || 'author1',
    tags: overrides.tags || [],
    created_at: overrides.created_at || Math.floor(Date.now() / 1000),
    content: overrides.content || ''
  };
}

describe('CommunityThreadModel', () => {
  it('returns direct community threads (h-tagged kind 11 events)', () => {
    const thread1 = mockEvent({
      kind: 11,
      tags: [
        ['h', COMMUNITY_PUBKEY],
        ['title', 'First Thread']
      ],
      content: 'Hello community!'
    });
    const thread2 = mockEvent({
      kind: 11,
      tags: [
        ['h', COMMUNITY_PUBKEY],
        ['title', 'Second Thread']
      ],
      content: 'Another discussion'
    });

    const store = {
      model: (/** @type {any} */ _ModelClass, /** @type {any} */ filter) => {
        if (filter.kinds?.includes(30222)) return of([]);
        if (filter['#h']) return of([thread1, thread2]);
        return of([thread1, thread2]);
      }
    };

    /** @type {any} */
    let result;
    CommunityThreadModel(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe(
      (items) => (result = items)
    );

    expect(result).toHaveLength(2);
    expect(result.map((/** @type {any} */ r) => r.id)).toContain(thread1.id);
    expect(result.map((/** @type {any} */ r) => r.id)).toContain(thread2.id);
  });

  it('resolves targeted publication references by event ID (e-tag)', () => {
    const thread = mockEvent({
      id: 'thread-abc',
      kind: 11,
      content: 'A shared thread'
    });
    const share = mockEvent({
      kind: 30222,
      tags: [
        ['p', COMMUNITY_PUBKEY],
        ['e', 'thread-abc'],
        ['k', '11']
      ]
    });

    const store = {
      model: (/** @type {any} */ _ModelClass, /** @type {any} */ filter) => {
        if (filter.kinds?.includes(30222) || filter['#k']) return of([share]);
        if (filter['#h']) return of([]);
        return of([thread]);
      }
    };

    /** @type {any} */
    let result;
    CommunityThreadModel(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe(
      (items) => (result = items)
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('thread-abc');
  });

  it('deduplicates — direct content takes priority over shares', () => {
    const thread = mockEvent({
      id: 'dup-thread',
      kind: 11,
      tags: [['h', COMMUNITY_PUBKEY]],
      content: 'Duplicate thread'
    });
    const share = mockEvent({
      kind: 30222,
      tags: [
        ['p', COMMUNITY_PUBKEY],
        ['e', 'dup-thread'],
        ['k', '11']
      ]
    });

    const store = {
      model: (/** @type {any} */ _ModelClass, /** @type {any} */ filter) => {
        if (filter.kinds?.includes(30222) || filter['#k']) return of([share]);
        if (filter['#h']) return of([thread]);
        return of([thread]);
      }
    };

    /** @type {any} */
    let result;
    CommunityThreadModel(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe(
      (items) => (result = items)
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('dup-thread');
  });

  it('returns empty array when no threads exist', () => {
    const store = {
      model: (/** @type {any} */ _ModelClass, /** @type {any} */ _filter) => of([])
    };

    /** @type {any} */
    let result;
    CommunityThreadModel(COMMUNITY_PUBKEY)(/** @type {any} */ (store)).subscribe(
      (items) => (result = items)
    );

    expect(result).toEqual([]);
  });
});
