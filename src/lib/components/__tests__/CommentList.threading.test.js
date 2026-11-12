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

const loadReferencedEvent = vi.hoisted(() => vi.fn());
vi.mock('$lib/loaders/referenced-event.js', async () => {
  const { EMPTY } = await import('rxjs');
  loadReferencedEvent.mockReturnValue(EMPTY);
  return { loadReferencedEvent };
});

// Stub heavy children — we only assert on the comment-count badge that
// CommentList renders directly from countComments(commentTree).
const CommentThread = vi.hoisted(() => vi.fn());
vi.mock('../comments/CommentThread.svelte', () => ({ default: CommentThread }));

// Network sources: one followed author, one with a trust rank; nobody muted.
const { FRIEND, RANKED } = vi.hoisted(() => ({ FRIEND: 'f'.repeat(64), RANKED: 'e'.repeat(64) }));
vi.mock('$lib/stores/contacts.svelte.js', () => ({ contactsStore: { contacts: [FRIEND] } }));
vi.mock('$lib/stores/member-directory.svelte.js', () => ({
  ensureMemberDirectory: () => {},
  getMemberPubkeys: () => new Set()
}));
vi.mock('$lib/stores/trust-scores.svelte.js', () => ({
  useTrustScores: () => () => new Map([[RANKED, { rank: 40 }]])
}));
vi.mock('$lib/stores/mute-list.svelte.js', () => ({
  getMutedPubkeys: () => new Set(),
  getMutedWords: () => new Set()
}));
vi.mock('../comments/CommentInput.svelte', () => ({ default: vi.fn() }));
vi.mock('../comments/AncestorChain.svelte', () => ({ default: vi.fn() }));
vi.mock('$lib/components/icons', () => ({ ChevronLeftIcon: vi.fn() }));

vi.mock('$lib/paraglide/messages', () => ({
  comments_list_title: () => 'Comments',
  comments_list_placeholder: () => '',
  comments_list_login_prompt: () => '',
  comments_list_empty: () => '',
  comments_back_button: () => '',
  comments_back_to_full_thread: () => '',
  comments_show_others: ({ count }) => `more ${count}`,
  comments_hide_others: () => 'hide'
}));

import CommentList from '../comments/CommentList.svelte';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';

/**
 * Build a verified Nostr event the EventStore will accept.
 * @param {string} idSeed
 * @param {number} kind
 * @param {string[][]} tags
 */
function makeEvent(idSeed, kind, tags, pubkey = 'a'.repeat(64)) {
  const event = {
    id: idSeed.padEnd(64, '0'),
    pubkey,
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

  it('owns the heading above the sheet; embedded mode drops heading and sheet', async () => {
    const root = makeEvent('abab0000', 30023, [['d', 'h']]);
    render(CommentList, { props: { rootEvent: root, activeUser: null, title: 'Diskussion' } });
    await waitFor(() => expect(document.querySelector('h2')?.textContent).toBe('Diskussion'));
    expect(document.querySelector('.card')).not.toBeNull();
    document.body.innerHTML = '';

    render(CommentList, { props: { rootEvent: root, activeUser: null, embedded: true } });
    await waitFor(() =>
      expect(document.querySelector('[data-testid="comment-login-prompt"]')).not.toBeNull()
    );
    expect(document.querySelector('h2')).toBeNull();
    expect(document.querySelector('.card')).toBeNull();
  });

  it('fetches a missing parent by id from the e tag hint and its author', async () => {
    const root = makeEvent('dddd4444', 30023, [['d', 'post']]);
    const parentId = 'eeee5555'.padEnd(64, '0');
    const author = 'c'.repeat(64);
    // Reply whose parent never reached our relays (NIP-22 e tag: id, hint, pubkey)
    const reply = makeEvent('ffff6666', 1111, [
      ['A', `30023:${root.pubkey}:post`],
      ['K', '30023'],
      ['e', parentId, 'wss://their.relay/', author],
      ['k', '1111']
    ]);
    eventStore.add(reply);

    render(CommentList, { props: { rootEvent: root, activeUser: null } });

    await waitFor(() => {
      expect(loadReferencedEvent).toHaveBeenCalledWith(
        { id: parentId, relays: ['wss://their.relay/'] },
        { author }
      );
    });
    expect(loadReferencedEvent).toHaveBeenCalledTimes(1);
  });

  it('shows threads from the network first and the rest behind a button', async () => {
    const root = makeEvent('1234aaaa', 1, [], 'd'.repeat(64));
    const reply = (seed, pubkey) => makeEvent(seed, 1, [['e', root.id, '', 'root']], pubkey);
    const friend = reply('1234bbbb', FRIEND);
    const ranked = reply('1234cccc', RANKED);
    const stranger = reply('1234dddd', '9'.repeat(64));
    [root, friend, ranked, stranger].forEach((e) => eventStore.add(e));
    CommentThread.mockClear();

    render(CommentList, { props: { rootEvent: root, activeUser: null } });

    const button = await waitFor(() => {
      const b = document.querySelector('[data-testid="comment-show-others"]');
      expect(b?.textContent?.trim()).toBe('more 1');
      return b;
    });
    const rendered = () => new Set(CommentThread.mock.calls.map(([, props]) => props.comment.id));
    expect(rendered()).toEqual(new Set([friend.id, ranked.id]));

    button.click();
    await waitFor(() => expect(rendered().has(stranger.id)).toBe(true));
    expect(button.textContent.trim()).toBe('hide');
    expect(button.getAttribute('aria-expanded')).toBe('true');

    // Collapsing again restores the button label
    button.click();
    await waitFor(() => expect(button.textContent.trim()).toBe('more 1'));
  });
});
