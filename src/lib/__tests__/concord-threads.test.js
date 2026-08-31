/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  aggregateThreads,
  getThreadRootId,
  threadRepliesFor,
  buildThreadReplyTemplate
} from '$lib/concord/threads.js';

const ROOT_AUTHOR = 'a'.repeat(64);
const REPLIER = 'b'.repeat(64);

/** A kind-9 chat message acting as a thread root. */
const rootMsg = {
  id: 'root-1',
  kind: 9,
  pubkey: ROOT_AUTHOR,
  content: 'root message',
  created_at: 1000,
  tags: [['channel', 'chan-1']]
};

/**
 * A NIP-22 comment the way Armada's buildV2CommentTags emits it.
 * @param {string} id @param {string} rootId @param {string} parentId
 * @param {string} parentAuthor @param {number} created_at @param {number} [ms]
 */
function comment(id, rootId, parentId, parentAuthor, created_at, ms) {
  /** @type {any} */
  const rumor = {
    id,
    kind: 1111,
    pubkey: REPLIER,
    content: `reply ${id}`,
    created_at,
    tags: [
      ['K', '9'],
      ['E', rootId, '', ROOT_AUTHOR],
      ['P', ROOT_AUTHOR],
      ['k', '9'],
      ['e', parentId, '', parentAuthor],
      ['p', parentAuthor]
    ]
  };
  if (ms !== undefined) rumor.ms = ms;
  return rumor;
}

describe('getThreadRootId', () => {
  it('returns the uppercase E tag for kind-1111 comments', () => {
    expect(getThreadRootId(comment('c1', 'root-1', 'root-1', ROOT_AUTHOR, 1001))).toBe('root-1');
  });

  it('returns null for kind-9 messages even when they carry e/q tags (inline replies are not threads)', () => {
    expect(getThreadRootId({ kind: 9, tags: [['q', 'root-1']] })).toBeNull();
    expect(getThreadRootId({ kind: 9, tags: [['e', 'root-1']] })).toBeNull();
    expect(getThreadRootId({ kind: 1111, tags: [] })).toBeNull();
  });
});

describe('aggregateThreads', () => {
  it('counts replies per root and tracks the latest created_at', () => {
    const comments = [
      comment('c1', 'root-1', 'root-1', ROOT_AUTHOR, 1001),
      comment('c2', 'root-1', 'c1', REPLIER, 1005),
      comment('c3', 'root-2', 'root-2', ROOT_AUTHOR, 1002)
    ];
    const map = aggregateThreads(comments);
    expect(map.get('root-1')).toEqual({ count: 2, latest: 1005 });
    expect(map.get('root-2')).toEqual({ count: 1, latest: 1002 });
  });

  it('ignores rumors without an E root and returns an empty map for no comments', () => {
    expect(aggregateThreads([]).size).toBe(0);
    expect(aggregateThreads([{ kind: 1111, tags: [] }]).size).toBe(0);
  });
});

describe('threadRepliesFor', () => {
  it('returns only the given root’s replies, oldest first, ms as tie-break', () => {
    const comments = [
      comment('late', 'root-1', 'root-1', ROOT_AUTHOR, 1005),
      comment('early', 'root-1', 'root-1', ROOT_AUTHOR, 1001),
      comment('tie-b', 'root-1', 'root-1', ROOT_AUTHOR, 1003, 200),
      comment('tie-a', 'root-1', 'root-1', ROOT_AUTHOR, 1003, 100),
      comment('other', 'root-2', 'root-2', ROOT_AUTHOR, 1000)
    ];
    expect(threadRepliesFor(comments, 'root-1').map((c) => c.id)).toEqual([
      'early',
      'tie-a',
      'tie-b',
      'late'
    ]);
  });
});

describe('buildThreadReplyTemplate', () => {
  it('replying to a kind-9 ROOT pins K/E/P to the root and k/e/p to the same root', () => {
    const template = buildThreadReplyTemplate(rootMsg, 'my reply');
    expect(template.kind).toBe(1111);
    expect(template.content).toBe('my reply');
    expect(typeof template.created_at).toBe('number');
    expect(template.tags).toEqual([
      ['K', '9'],
      ['E', 'root-1', '', ROOT_AUTHOR],
      ['P', ROOT_AUTHOR],
      ['k', '9'],
      ['e', 'root-1', '', ROOT_AUTHOR],
      ['p', ROOT_AUTHOR]
    ]);
  });

  it('replying to a COMMENT inherits the root K/E/P verbatim and points k/e/p at the comment', () => {
    const parent = comment('c1', 'root-1', 'root-1', ROOT_AUTHOR, 1001);
    const template = buildThreadReplyTemplate(parent, 'nested');
    expect(template.tags).toEqual([
      ['K', '9'],
      ['E', 'root-1', '', ROOT_AUTHOR],
      ['P', ROOT_AUTHOR],
      ['k', '1111'],
      ['e', 'c1', '', REPLIER],
      ['p', REPLIER]
    ]);
  });
});
