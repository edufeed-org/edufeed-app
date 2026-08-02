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
  inbox_mark_read: () => 'Mark as read'
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
});
