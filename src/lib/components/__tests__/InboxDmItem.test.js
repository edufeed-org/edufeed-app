/**
 * InboxDmItem — a kind-15 lastMessage's content is the encrypted blob's URL,
 * never plain text. The inbox dropdown must show the dmPreviewText label
 * (same fix as Task 4's ConversationList change), not the raw URL
 * (laoc, 2026-09-18).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);

vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/services/dm-service.svelte.js', () => ({ markConversationAsRead: vi.fn() }));
vi.mock('$lib/helpers/nostrUtils.js', () => ({
  profileLink: (/** @type {string} */ pk) => `/p/${pk}`
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => ({ pubkey: ME }) }));
vi.mock('$lib/components/shared/ProfileAvatar.svelte', async () => {
  const mock = await import('./__mocks__/EmptyStub.svelte');
  return { default: mock.default };
});
vi.mock('$lib/paraglide/messages.js', () => ({
  inbox_action_dm: () => 'sent you a message',
  inbox_mark_read: () => 'Mark as read',
  dm_preview_image: () => 'Image',
  dm_preview_file: () => 'File'
}));

import InboxDmItem from '$lib/components/inbox/InboxDmItem.svelte';

describe('InboxDmItem preview text', () => {
  it('shows the file preview label instead of the blob URL for a kind-15 lastMessage', () => {
    const conversation = {
      id: `${ME}:${PEER}`,
      participants: [ME, PEER],
      lastMessage: {
        id: 'r1',
        kind: 15,
        pubkey: PEER,
        created_at: 100,
        tags: [['p', ME]],
        content: 'https://blossom.example/abc123.bin'
      }
    };
    render(InboxDmItem, { props: { conversation, unread: false } });
    expect(screen.queryByText('https://blossom.example/abc123.bin')).toBeNull();
    expect(screen.getByText('File')).toBeTruthy();
  });

  it('still shows plain text content for a kind-14 lastMessage', () => {
    const conversation = {
      id: `${ME}:${PEER}`,
      participants: [ME, PEER],
      lastMessage: {
        id: 'r2',
        kind: 14,
        pubkey: PEER,
        created_at: 100,
        tags: [['p', ME]],
        content: 'hallo'
      }
    };
    render(InboxDmItem, { props: { conversation, unread: false } });
    expect(screen.getByText('hallo')).toBeTruthy();
  });
});
