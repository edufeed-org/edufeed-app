/**
 * InboxItem Component Tests — kind 1 reply / note-mention labels.
 *
 * Kind 1 notifications reach the inbox as two distinct types: a 'reply' (the
 * note e-tags something) and a 'mention' (it only p-tags the user). Kind 9
 * community chat also maps to 'mention', so the mention label has to branch
 * on the event kind.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import InboxItem from '../inbox/InboxItem.svelte';

vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: { debugMode: false, gatedMode: false }
}));

vi.mock('$lib/services/inbox-service.svelte.js', () => ({
  markItemAsRead: vi.fn()
}));

vi.mock('$lib/helpers/waves.js', () => ({ publishWave: vi.fn() }));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { replaceable: () => ({ subscribe: vi.fn() }) },
  pool: { request: vi.fn() }
}));

vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));

vi.mock('$lib/paraglide/messages.js', () => ({
  inbox_action_reply: () => 'replied to your note',
  inbox_action_note_mention: () => 'mentioned you in a note',
  inbox_action_mention: (/** @type {any} */ { communityName }) =>
    `mentioned you in ${communityName}`,
  inbox_action_thread_mention: (/** @type {any} */ { title }) =>
    `mentioned you in the thread ${title}`,
  inbox_action_article_mention: (/** @type {any} */ { title }) =>
    `mentioned you in the article ${title}`,
  inbox_action_wiki_mention: (/** @type {any} */ { title }) =>
    `mentioned you in the wiki page ${title}`,
  inbox_action_untitled: () => 'Untitled',
  inbox_action_reaction: () => 'reacted',
  inbox_action_comment: () => 'commented',
  inbox_action_rsvp: () => 'rsvped',
  inbox_action_wave: () => 'waved',
  inbox_action_poll_vote: () => 'voted',
  inbox_action_form_request: () => 'form request',
  inbox_action_form_response: () => 'form response',
  inbox_mark_read: () => 'Mark as read',
  inbox_block_success: () => 'blocked',
  inbox_block_action: () => 'Block',
  aria_inbox_item_menu: () => 'Notification options',
  dm_block_sender: () => 'Block sender',
  dm_block_failed: () => 'block failed',
  wave_back_button: () => 'Wave back',
  wave_success: () => 'waved back',
  wave_error: () => 'wave failed'
}));

vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ path) => path }));

const PUBKEY = 'aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344';

/**
 * @param {number} kind
 * @param {string[][]} tags
 */
function makeEvent(kind, tags) {
  return {
    id: 'c'.repeat(64),
    kind,
    pubkey: PUBKEY,
    tags,
    created_at: Math.floor(Date.now() / 1000) - 60,
    content: 'hello',
    sig: 'mock-sig'
  };
}

describe('InboxItem kind 1 labels', () => {
  it('labels a kind 1 reply as a reply to the note', () => {
    render(InboxItem, {
      props: { event: makeEvent(1, [['e', 'a'.repeat(64)]]), unread: true }
    });
    expect(screen.getByText(/replied to your note/)).toBeTruthy();
  });

  it('labels a kind 1 note mention without a community name', () => {
    render(InboxItem, {
      props: { event: makeEvent(1, [['p', PUBKEY]]), unread: true }
    });
    expect(screen.getByText(/mentioned you in a note/)).toBeTruthy();
  });

  it('still labels a kind 9 community mention with the community name', () => {
    render(InboxItem, {
      props: {
        event: makeEvent(9, [['h', 'communitypubkey']]),
        unread: true,
        contentTitle: 'Mathe AG'
      }
    });
    expect(screen.getByText(/mentioned you in Mathe AG/)).toBeTruthy();
  });

  it('labels article, wiki and thread mentions with the event title', () => {
    render(InboxItem, {
      props: { event: makeEvent(30023, [['title', 'Big News']]), unread: true }
    });
    expect(screen.getByText(/mentioned you in the article Big News/)).toBeTruthy();
  });

  it('falls back to untitled when the page has no title tag', () => {
    render(InboxItem, {
      props: { event: makeEvent(30818, [['d', 'x']]), unread: true }
    });
    expect(screen.getByText(/mentioned you in the wiki page Untitled/)).toBeTruthy();
  });

  it('labels a thread mention', () => {
    render(InboxItem, {
      props: { event: makeEvent(11, [['title', 'Ausflug']]), unread: true }
    });
    expect(screen.getByText(/mentioned you in the thread Ausflug/)).toBeTruthy();
  });
});
