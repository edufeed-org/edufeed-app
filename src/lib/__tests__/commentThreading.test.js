/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  buildCommentTree,
  getPlainTextExcerpt,
  getParentChain,
  getSubtree,
  countComments,
  getCommentDepth
} from '$lib/helpers/commentThreading.js';

/**
 * @typedef {{ id: string, created_at: number, tags: any[], content: string, replies: any[], parentComment: any }} TreeNode
 */

// Helper to build a minimal comment tree for testing navigation utilities.
function makeTree() {
  /** @type {TreeNode} */
  const e = {
    id: 'e',
    created_at: 170,
    tags: [],
    content: 'reply to D (deeper)',
    replies: [],
    parentComment: null
  };
  /** @type {TreeNode} */
  const d = {
    id: 'd',
    created_at: 160,
    tags: [],
    content: 'reply to C (deep)',
    replies: [e],
    parentComment: null
  };
  e.parentComment = d;

  /** @type {TreeNode} */
  const c = {
    id: 'c',
    created_at: 150,
    tags: [],
    content: 'reply to A',
    replies: [d],
    parentComment: null
  };
  d.parentComment = c;

  /** @type {TreeNode} */
  const a = {
    id: 'a',
    created_at: 100,
    tags: [],
    content: 'top-level A',
    replies: [c],
    parentComment: null
  };
  c.parentComment = a;

  /** @type {TreeNode} */
  const b = {
    id: 'b',
    created_at: 200,
    tags: [],
    content: 'top-level B',
    replies: [],
    parentComment: null
  };

  // Return sorted newest first (b, a)
  return [b, a];
}

/**
 * Helper: create a flat comment event with proper NIP-22 tags.
 * @param {string} id
 * @param {number} created_at
 * @param {string} content
 * @param {{ parentEventId?: string, rootEventId: string, rootKind: number }} opts
 */
function makeComment(id, created_at, content, opts) {
  const { parentEventId, rootEventId, rootKind } = opts;

  // Root scope tags (uppercase)
  const tags = [
    ['E', rootEventId],
    ['K', String(rootKind)]
  ];

  if (parentEventId) {
    // Reply to another comment: lowercase e/k point to parent comment
    tags.push(['e', parentEventId]);
    tags.push(['k', '1111']);
  } else {
    // Top-level comment: lowercase e/k point to root event
    tags.push(['e', rootEventId]);
    tags.push(['k', String(rootKind)]);
  }

  return { id, kind: 1111, created_at, content, tags, pubkey: 'testpub', sig: 'testsig' };
}

describe('buildCommentTree', () => {
  it('returns empty array for null/undefined/empty input', () => {
    expect(buildCommentTree(/** @type {any} */ (null))).toEqual([]);
    expect(buildCommentTree(/** @type {any} */ (undefined))).toEqual([]);
    expect(buildCommentTree([])).toEqual([]);
  });

  it('builds a flat list of top-level comments', () => {
    const comments = [
      makeComment('a', 100, 'first', { rootEventId: 'root1', rootKind: 11 }),
      makeComment('b', 200, 'second', { rootEventId: 'root1', rootKind: 11 })
    ];

    const tree = buildCommentTree(comments);
    expect(tree).toHaveLength(2);
    // Sorted newest first
    expect(tree[0].id).toBe('b');
    expect(tree[1].id).toBe('a');
    expect(tree[0].replies).toEqual([]);
    expect(tree[1].replies).toEqual([]);
  });

  it('nests replies under their parent comments', () => {
    const comments = [
      makeComment('a', 100, 'top-level', { rootEventId: 'root1', rootKind: 11 }),
      makeComment('b', 200, 'reply to a', {
        rootEventId: 'root1',
        rootKind: 11,
        parentEventId: 'a'
      }),
      makeComment('c', 300, 'reply to b', {
        rootEventId: 'root1',
        rootKind: 11,
        parentEventId: 'b'
      })
    ];

    const tree = buildCommentTree(comments);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('a');
    expect(tree[0].replies).toHaveLength(1);
    expect(tree[0].replies[0].id).toBe('b');
    expect(tree[0].replies[0].replies).toHaveLength(1);
    expect(tree[0].replies[0].replies[0].id).toBe('c');
  });

  it('treats orphaned comments (missing parent) as top-level', () => {
    const comments = [
      makeComment('a', 100, 'top-level', { rootEventId: 'root1', rootKind: 11 }),
      makeComment('orphan', 200, 'orphan reply', {
        rootEventId: 'root1',
        rootKind: 11,
        parentEventId: 'nonexistent'
      })
    ];

    const tree = buildCommentTree(comments);
    // Both should be top-level since orphan's parent is not in the list
    expect(tree).toHaveLength(2);
  });

  it('sorts replies newest first', () => {
    const comments = [
      makeComment('a', 100, 'top-level', { rootEventId: 'root1', rootKind: 11 }),
      makeComment('r1', 200, 'first reply', {
        rootEventId: 'root1',
        rootKind: 11,
        parentEventId: 'a'
      }),
      makeComment('r2', 300, 'second reply', {
        rootEventId: 'root1',
        rootKind: 11,
        parentEventId: 'a'
      }),
      makeComment('r3', 250, 'third reply', {
        rootEventId: 'root1',
        rootKind: 11,
        parentEventId: 'a'
      })
    ];

    const tree = buildCommentTree(comments);
    expect(tree[0].replies.map((/** @type {any} */ r) => r.id)).toEqual(['r2', 'r3', 'r1']);
  });
});

describe('buildCommentTree with missing k tag (interop)', () => {
  /**
   * Helper: create a comment missing the lowercase k tag (like some clients emit).
   * @param {string} id
   * @param {number} created_at
   * @param {string} content
   * @param {{ parentEventId?: string, rootEventId: string, rootKind: number }} opts
   */
  function makeCommentNoKTag(id, created_at, content, opts) {
    const { parentEventId, rootEventId, rootKind } = opts;
    const tags = [
      ['E', rootEventId],
      ['K', String(rootKind)]
    ];

    if (parentEventId) {
      // Reply to another comment: lowercase e points to parent, but NO k tag
      tags.push(['e', parentEventId]);
    } else {
      // Top-level: lowercase e points to root
      tags.push(['e', rootEventId]);
    }

    return { id, kind: 1111, created_at, content, tags, pubkey: 'testpub', sig: 'testsig' };
  }

  it('detects reply when k tag is missing but e differs from E', () => {
    const comments = [
      makeComment('parent', 100, 'top-level', { rootEventId: 'root1', rootKind: 11 }),
      makeCommentNoKTag('reply', 200, 'reply without k tag', {
        rootEventId: 'root1',
        rootKind: 11,
        parentEventId: 'parent'
      })
    ];

    const tree = buildCommentTree(comments);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('parent');
    expect(tree[0].replies).toHaveLength(1);
    expect(tree[0].replies[0].id).toBe('reply');
  });

  it('treats as top-level when k tag is missing and e equals E', () => {
    const comments = [
      makeCommentNoKTag('top', 100, 'top-level without k tag', {
        rootEventId: 'root1',
        rootKind: 11
      })
    ];

    const tree = buildCommentTree(comments);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('top');
    expect(tree[0].replies).toEqual([]);
  });

  it('builds correct tree with missing k tags in multi-level thread', () => {
    const comments = [
      makeComment('a', 100, 'top-level', { rootEventId: 'root1', rootKind: 11 }),
      makeCommentNoKTag('b', 200, 'reply to a (no k tag)', {
        rootEventId: 'root1',
        rootKind: 11,
        parentEventId: 'a'
      }),
      makeComment('c', 300, 'reply to b (with k tag)', {
        rootEventId: 'root1',
        rootKind: 11,
        parentEventId: 'b'
      })
    ];

    const tree = buildCommentTree(comments);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('a');
    expect(tree[0].replies).toHaveLength(1);
    expect(tree[0].replies[0].id).toBe('b');
    expect(tree[0].replies[0].replies).toHaveLength(1);
    expect(tree[0].replies[0].replies[0].id).toBe('c');
  });
});

describe('buildCommentTree with kind 1 NIP-10 replies', () => {
  /**
   * Helper: create a kind 1 reply event with NIP-10 e-tags
   * @param {string} id
   * @param {number} created_at
   * @param {string} content
   * @param {{ rootId: string, parentId?: string, useMarkers?: boolean }} opts
   */
  function makeKind1Reply(id, created_at, content, opts) {
    const { rootId, parentId, useMarkers = true } = opts;
    const tags = [];

    if (useMarkers) {
      tags.push(['e', rootId, '', 'root']);
      if (parentId) {
        tags.push(['e', parentId, '', 'reply']);
      }
    } else {
      // Legacy positional: first = root, last = reply-to
      tags.push(['e', rootId]);
      if (parentId) {
        tags.push(['e', parentId]);
      }
    }

    return { id, kind: 1, created_at, content, tags, pubkey: 'testpub', sig: 'testsig' };
  }

  it('treats kind 1 with only root marker as top-level', () => {
    const replies = [makeKind1Reply('r1', 100, 'direct reply', { rootId: 'root1' })];

    const tree = buildCommentTree(replies);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('r1');
  });

  it('nests kind 1 reply with reply marker under parent', () => {
    const replies = [
      makeKind1Reply('r1', 100, 'direct reply', { rootId: 'root1' }),
      makeKind1Reply('r2', 200, 'reply to r1', { rootId: 'root1', parentId: 'r1' })
    ];

    const tree = buildCommentTree(replies);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('r1');
    expect(tree[0].replies).toHaveLength(1);
    expect(tree[0].replies[0].id).toBe('r2');
  });

  it('handles legacy positional e-tags (no markers)', () => {
    const replies = [
      makeKind1Reply('r1', 100, 'direct reply', { rootId: 'root1', useMarkers: false }),
      makeKind1Reply('r2', 200, 'reply to r1', {
        rootId: 'root1',
        parentId: 'r1',
        useMarkers: false
      })
    ];

    const tree = buildCommentTree(replies);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('r1');
    expect(tree[0].replies).toHaveLength(1);
    expect(tree[0].replies[0].id).toBe('r2');
  });

  it('treats single legacy e-tag as top-level', () => {
    const replies = [
      makeKind1Reply('r1', 100, 'direct reply', { rootId: 'root1', useMarkers: false })
    ];

    const tree = buildCommentTree(replies);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('r1');
  });

  it('mixes kind 1111 and kind 1 replies in the same tree', () => {
    const comments = [
      makeComment('c1', 100, 'NIP-22 comment', { rootEventId: 'root1', rootKind: 1 }),
      makeKind1Reply('r1', 200, 'NIP-10 reply', { rootId: 'root1' })
    ];

    const tree = buildCommentTree(comments);
    expect(tree).toHaveLength(2);
    // Both are top-level
    expect(tree.map((c) => c.id).sort()).toEqual(['c1', 'r1']);
  });
});

describe('getPlainTextExcerpt', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(getPlainTextExcerpt(null)).toBe('');
    expect(getPlainTextExcerpt(undefined)).toBe('');
    expect(getPlainTextExcerpt('')).toBe('');
  });

  it('returns text unchanged when under limit', () => {
    expect(getPlainTextExcerpt('Hello world')).toBe('Hello world');
  });

  it('strips markdown formatting characters', () => {
    expect(getPlainTextExcerpt('**bold** and *italic*')).toBe('bold and italic');
    expect(getPlainTextExcerpt('# Heading')).toBe('Heading');
    expect(getPlainTextExcerpt('`code` block')).toBe('code block');
    expect(getPlainTextExcerpt('[link](url)')).toBe('link(url)');
    expect(getPlainTextExcerpt('> blockquote')).toBe('blockquote');
    expect(getPlainTextExcerpt('~~strikethrough~~')).toBe('strikethrough');
  });

  it('collapses multiple newlines into spaces', () => {
    expect(getPlainTextExcerpt('line one\n\nline two\nline three')).toBe(
      'line one line two line three'
    );
  });

  it('truncates text exceeding maxLength with ellipsis', () => {
    const long = 'a'.repeat(150);
    const result = getPlainTextExcerpt(long, 100);
    expect(result.length).toBe(101); // 100 chars + ellipsis
    expect(result.endsWith('…')).toBe(true);
  });

  it('respects custom maxLength', () => {
    const text = 'Hello world, this is a test string';
    const result = getPlainTextExcerpt(text, 10);
    expect(result).toBe('Hello worl…');
  });

  it('does not truncate text exactly at maxLength', () => {
    const text = 'a'.repeat(100);
    expect(getPlainTextExcerpt(text, 100)).toBe(text);
  });

  it('trims whitespace', () => {
    expect(getPlainTextExcerpt('  spaced  ')).toBe('spaced');
  });
});

describe('getParentChain', () => {
  it('returns path from root to target (inclusive)', () => {
    const tree = makeTree();
    // Comment 'e' is nested: a -> c -> d -> e
    const chain = getParentChain(tree, 'e');
    const ids = chain.map((n) => n.id);
    expect(ids).toEqual(['a', 'c', 'd', 'e']);
  });

  it('returns single-element array for top-level comment', () => {
    const tree = makeTree();
    const chain = getParentChain(tree, 'b');
    expect(chain.map((n) => n.id)).toEqual(['b']);
  });

  it('returns empty array for non-existent ID', () => {
    const tree = makeTree();
    expect(getParentChain(tree, 'nonexistent')).toEqual([]);
  });

  it('returns empty array for empty tree', () => {
    expect(getParentChain([], 'a')).toEqual([]);
  });
});

describe('getSubtree', () => {
  it('returns the node with its replies', () => {
    const tree = makeTree();
    const subtree = getSubtree(tree, 'c');
    expect(subtree).not.toBeNull();
    expect(subtree.id).toBe('c');
    expect(subtree.replies.length).toBe(1);
    expect(subtree.replies[0].id).toBe('d');
  });

  it('returns null for non-existent ID', () => {
    const tree = makeTree();
    expect(getSubtree(tree, 'nonexistent')).toBeNull();
  });

  it('returns top-level node', () => {
    const tree = makeTree();
    const subtree = getSubtree(tree, 'a');
    expect(subtree).not.toBeNull();
    expect(subtree.id).toBe('a');
  });

  it('returns null for empty tree', () => {
    expect(getSubtree([], 'a')).toBeNull();
  });
});

describe('countComments', () => {
  it('counts all comments including nested replies', () => {
    const tree = makeTree();
    // b(1) + a(1) + c(1) + d(1) + e(1) = 5
    expect(countComments(tree)).toBe(5);
  });

  it('returns 0 for empty tree', () => {
    expect(countComments([])).toBe(0);
  });
});

describe('getCommentDepth', () => {
  it('returns 0 for top-level comments', () => {
    const tree = makeTree();
    expect(getCommentDepth(tree, 'a')).toBe(0);
    expect(getCommentDepth(tree, 'b')).toBe(0);
  });

  it('returns correct depth for nested comments', () => {
    const tree = makeTree();
    expect(getCommentDepth(tree, 'c')).toBe(1);
    expect(getCommentDepth(tree, 'd')).toBe(2);
    expect(getCommentDepth(tree, 'e')).toBe(3);
  });

  it('returns -1 for non-existent ID', () => {
    const tree = makeTree();
    expect(getCommentDepth(tree, 'nonexistent')).toBe(-1);
  });
});
