/**
 * ConversationList — the DM list must separate known senders from message
 * requests: known conversations render in the main list, stranger
 * conversations sit behind a collapsed "requests" toggle that shows a count,
 * and blocking a request sender goes through the mute-list store.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () =>
  Object.fromEntries(
    [
      'dm_title',
      'dm_new_message',
      'dm_no_conversations',
      'dm_loading_messages',
      'dm_unlocking',
      'dm_self_note',
      'dm_legacy_badge',
      'dm_legacy_insecure_banner',
      'dm_requests_title',
      'dm_requests_hint',
      'dm_block_sender',
      'dm_block_failed',
      'profile_avatar_alt',
      'profile_avatar_fallback',
      'inbox_mark_read'
    ].map((k) => [k, () => k])
  )
);

const SELF = 'a'.repeat(64);
const FRIEND = 'b'.repeat(64);
const STRANGER = 'c'.repeat(64);

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: SELF })
}));

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

const mockDmService = vi.hoisted(() => ({
  known: /** @type {any[]} */ ([]),
  requests: /** @type {any[]} */ ([])
}));
vi.mock('$lib/services/dm-service.svelte.js', () => ({
  getKnownDmConversations: () => mockDmService.known,
  getDmRequestConversations: () => mockDmService.requests,
  hasInitialDmsLoaded: () => true,
  isUnlockingDms: () => false,
  getLockedCount: () => 0,
  isDmConversationUnread: () => false,
  markConversationAsRead: vi.fn()
}));

const mockMuteUser = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('$lib/stores/mute-list.svelte.js', () => ({
  muteUser: mockMuteUser
}));

const ConversationList = (await import('$lib/components/dm/ConversationList.svelte')).default;

/** @param {string} peer @param {number} ts */
function conv(peer, ts = 1000) {
  return {
    id: `${SELF}:${peer}`,
    participants: [SELF, peer],
    lastMessage: { pubkey: peer, content: `hello from ${peer.slice(0, 4)}`, created_at: ts }
  };
}

const baseProps = { onSelectConversation: vi.fn(), onNewMessage: vi.fn() };

beforeEach(() => {
  mockDmService.known = [];
  mockDmService.requests = [];
  mockMuteUser.mockClear();
});

describe('ConversationList requests split', () => {
  it('renders known conversations without a requests toggle when there are no requests', () => {
    mockDmService.known = [conv(FRIEND)];
    const { queryByText, getByText } = render(ConversationList, { props: baseProps });
    expect(getByText(/hello from bbbb/)).toBeTruthy();
    expect(queryByText(/dm_requests_title/)).toBeNull();
  });

  it('hides request conversations behind a collapsed toggle with a count', async () => {
    mockDmService.known = [conv(FRIEND)];
    mockDmService.requests = [conv(STRANGER)];
    const { getByText, queryByText } = render(ConversationList, { props: baseProps });

    const toggle = getByText(/dm_requests_title \(1\)/);
    expect(queryByText(/hello from cccc/)).toBeNull();

    await fireEvent.click(toggle);
    expect(getByText(/hello from cccc/)).toBeTruthy();
  });

  it('blocks a request sender via the mute-list store', async () => {
    mockDmService.requests = [conv(STRANGER)];
    const { getByText, getByTitle } = render(ConversationList, { props: baseProps });

    await fireEvent.click(getByText(/dm_requests_title \(1\)/));
    await fireEvent.click(getByTitle('dm_block_sender'));

    expect(mockMuteUser).toHaveBeenCalledWith(STRANGER);
  });

  it('shows the empty state only when both lists are empty', () => {
    mockDmService.requests = [conv(STRANGER)];
    const { queryByText } = render(ConversationList, { props: baseProps });
    expect(queryByText('dm_no_conversations')).toBeNull();
  });
});
