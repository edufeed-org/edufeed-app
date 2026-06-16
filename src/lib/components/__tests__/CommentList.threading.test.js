// @ts-nocheck
/**
 * CommentList threading regression test.
 *
 * Reproduces the bug where an event-rooted (kind 1) thread with nested replies
 * renders an incomplete comment set. The old event-rooted path walked the tree
 * with recursive RepliesModel subscriptions and reconciled them against a shared
 * Map using a deletion heuristic that matched ANY lowercase "e" tag equal to a
 * parent id. For NIP-10 replies, a nested reply carries the ROOT id in an "e"
 * tag (root marker), so the root-level deletion loop wrongly evicted nested
 * replies that RepliesModel(root) correctly excluded as non-direct.
 *
 * The fix uses a single root-scope TimelineModel subscription (NIP-22 #E plus
 * NIP-10 #e) as the source of truth, so the whole tree always renders.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import { fakeVerifyEvent } from 'applesauce-core/helpers';

// Real EventStore shared between the test and the component under test.
// Built inside the (hoisted) mock factory, then imported back below.
vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { EventStore } = await import('applesauce-core');
  const { EMPTY } = await import('rxjs');
  return { eventStore: new EventStore(), pool: { request: () => EMPTY } };
});

// No network: the store is pre-populated, so the deferred loader is a no-op.
vi.mock('$lib/loaders/comments.js', async () => {
  const { EMPTY } = await import('rxjs');
  return {
    createCommentLoaderForEvent: () => () => EMPTY,
    createCommentLoaderForUrl: () => () => EMPTY
  };
});

// Stub heavy children — we only assert on the comment-count badge that
// CommentList renders directly from countComments(commentTree).
vi.mock('../comments/CommentThread.svelte', () => ({ default: vi.fn() }));
vi.mock('../comments/CommentInput.svelte', () => ({ default: vi.fn() }));
vi.mock('../comments/AncestorChain.svelte', () => ({ default: vi.fn() }));
vi.mock('$lib/components/icons', () => ({ ChevronLeftIcon: vi.fn() }));

vi.mock('$lib/paraglide/messages', () => ({
  comments_list_title: () => 'Comments',
  comments_list_placeholder: () => '',
  comments_list_login_prompt: () => '',
  comments_list_empty: () => '',
  comments_back_button: () => '',
  comments_back_to_full_thread: () => ''
}));

import CommentList from '../comments/CommentList.svelte';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';

/**
 * Build a verified Nostr event the EventStore will accept.
 * @param {string} idSeed
 * @param {number} kind
 * @param {string[][]} tags
 */
function makeEvent(idSeed, kind, tags) {
  const event = {
    id: idSeed.padEnd(64, '0'),
    pubkey: 'a'.repeat(64),
    created_at: Math.floor(Date.now() / 1000),
    kind,
    tags,
    content: 'content ' + idSeed,
    sig: 'b'.repeat(128)
  };
  fakeVerifyEvent(event);
  return event;
}

describe('CommentList NIP-10 nested threading', () => {
  it('renders the full nested thread (root → reply → nested reply)', async () => {
    const rootId = 'aaaa1111';
    const c1Id = 'bbbb2222';
    const c11Id = 'cccc3333';

    const root = makeEvent(rootId, 1, []);
    // Direct reply to root (NIP-10 root marker).
    const c1 = makeEvent(c1Id, 1, [['e', root.id, '', 'root']]);
    // Nested reply to c1: carries BOTH root + reply e-tags per NIP-10.
    const c11 = makeEvent(c11Id, 1, [
      ['e', root.id, '', 'root'],
      ['e', c1.id, '', 'reply']
    ]);

    eventStore.add(root);
    eventStore.add(c1);
    eventStore.add(c11);

    render(CommentList, { props: { rootEvent: root, activeUser: null } });

    // Both the direct reply and the nested reply must be counted.
    await waitFor(() => {
      const badge = document.querySelector('[data-testid="comment-count"]');
      expect(badge?.textContent?.trim()).toBe('2');
    });
  });
});
