// @ts-nocheck
/**
 * Thread layout: replies indent one step (phone) / two steps (sm+) and then stay
 * put; every reply knows its parent (for the reply chip); the replies control
 * is handed to the parent's row instead of rendered as a connector button.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock('../comments/Comment.svelte', async () => ({
  default: (await import('./fixtures/CommentStub.svelte')).default
}));
vi.mock('$lib/paraglide/messages', () => ({
  comments_continue_thread: ({ count }) => `continue ${count}`,
  comments_continue_thread_singular: () => 'continue 1',
  comments_view_replies: ({ count }) => `show ${count}`,
  comments_view_reply: () => 'show 1',
  comments_hide_replies: () => 'hide'
}));

import CommentThread from '../comments/CommentThread.svelte';

/** @param {string} id @param {any[]} replies */
const node = (id, replies = []) => ({
  id,
  pubkey: 'a'.repeat(64),
  created_at: 1,
  tags: [],
  content: id,
  replies
});

describe('CommentThread indent and parent hand-off', () => {
  it('indents two steps, then stops; each reply gets its parent', () => {
    const tree = node('c0', [node('c1', [node('c2', [node('c3')])])]);
    render(CommentThread, {
      props: { comment: tree, rootEvent: {}, activeUser: null, maxDepth: 5 }
    });

    const wrappers = [...document.querySelectorAll('[data-testid="comment-replies"]')];
    expect(wrappers.map((w) => w.className.trim())).toEqual(['pl-9 sm:pl-[50px]', 'sm:pl-10', '']);

    const stubs = [...document.querySelectorAll('[data-testid="comment-stub"]')];
    expect(stubs.map((s) => [s.dataset.depth, s.dataset.parent])).toEqual([
      ['0', ''],
      ['1', 'c0'],
      ['2', 'c1'],
      ['3', 'c2']
    ]);
  });

  it('a collapsed strand hands the parent a "show replies" toggle that says it is closed', () => {
    const tree = node('c0', [node('c1')]);
    render(CommentThread, {
      props: { comment: tree, rootEvent: {}, activeUser: null, collapsedReplies: true }
    });
    const stubs = [...document.querySelectorAll('[data-testid="comment-stub"]')];
    expect(stubs.map((s) => [s.dataset.id, s.dataset.action, s.dataset.expanded])).toEqual([
      ['c0', 'expand-replies-btn', 'false']
    ]);
  });

  it('hands the "continue thread" control to the comment at the depth cap', () => {
    const tree = node('c0', [node('c1', [node('c2')])]);
    render(CommentThread, {
      props: {
        comment: tree,
        rootEvent: {},
        activeUser: null,
        maxDepth: 1,
        onFocusThread: () => {}
      }
    });
    const stubs = [...document.querySelectorAll('[data-testid="comment-stub"]')];
    expect(stubs.map((s) => [s.dataset.id, s.dataset.action])).toEqual([
      ['c0', ''],
      ['c1', 'continue-thread-btn']
    ]);
  });
});
