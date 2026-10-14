// @ts-nocheck
/** @vitest-environment jsdom */
// /c/inbox has two segments: Benachrichtigungen (default) and Nachrichten
// (?tab=messages, the DM conversation list). The phone dock links here instead
// of carrying a separate Nachrichten item.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

const state = vi.hoisted(() => ({
  notifications: [],
  conversations: [],
  unread: 0,
  unreadDm: 0
}));

vi.mock('$app/paths', () => ({ resolve: (p) => p }));
vi.mock('$app/stores', async () => {
  const { writable } = await import('svelte/store');
  const store = writable({ url: new URL('http://localhost/c/inbox') });
  return { page: store, __setUrl: (u) => store.set({ url: u }) };
});
vi.mock('$lib/services/inbox-service.svelte.js', () => ({
  getNotifications: () => state.notifications,
  getUnreadCount: () => state.unread,
  getUnreadByType: () => ({}),
  markAsRead: vi.fn(),
  isNotificationUnread: () => false
}));
vi.mock('$lib/services/dm-service.svelte.js', () => ({
  getKnownDmConversations: () => state.conversations,
  getUnreadDmCount: () => state.unreadDm,
  isDmConversationUnread: () => false
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => new Map() }));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: 'me'.padEnd(64, '0') })
}));
vi.mock('$lib/components/inbox/InboxItem.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));
vi.mock('$lib/components/inbox/Nip05ReadyRow.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));
vi.mock('$lib/components/shared/ReadonlyNotice.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));
vi.mock('$lib/components/inbox/InboxDmItem.svelte', async () => ({
  default: (await import('./__mocks__/DmRowStub.svelte')).default
}));
vi.mock('$lib/paraglide/messages.js', () => ({
  inbox_title: () => 'Posteingang',
  inbox_mark_all_read: () => 'Alle gelesen',
  inbox_empty: () => 'Nichts Neues',
  inbox_tab_notifications: () => 'Benachrichtigungen',
  inbox_tab_messages: () => 'Nachrichten',
  inbox_filter_all: () => 'Alle',
  inbox_filter_forms: () => 'Formulare',
  inbox_filter_reactions: () => 'Reaktionen',
  inbox_filter_waves: () => 'Winker',
  inbox_filter_comments: () => 'Kommentare',
  inbox_filter_replies: () => 'Antworten',
  inbox_filter_mentions: () => 'Erwähnungen',
  inbox_filter_rsvps: () => 'RSVPs'
}));

const stores = await import('$app/stores');
const { default: InboxPage } = await import('../../../routes/c/(dashboard)/inbox/+page.svelte');

const conv = (id) => ({
  id,
  participants: ['me'.padEnd(64, '0'), 'x'.repeat(64)],
  lastMessage: { created_at: 1, pubkey: 'x'.repeat(64) }
});

describe('Inbox page tabs', () => {
  beforeEach(() => {
    state.notifications = [];
    state.conversations = [];
    state.unread = 0;
    state.unreadDm = 0;
    stores.__setUrl(new URL('http://localhost/c/inbox'));
  });

  it('renders two tabs linking to the two segments', () => {
    const { getByTestId } = render(InboxPage);
    expect(getByTestId('inbox-tab-notifications').getAttribute('href')).toBe('/c/inbox');
    expect(getByTestId('inbox-tab-messages').getAttribute('href')).toBe('/c/inbox?tab=messages');
    expect(getByTestId('inbox-tab-notifications').className).toContain('tab-active');
  });

  it('has no "Nachrichten" filter chip on the notifications tab', () => {
    const { queryByRole } = render(InboxPage);
    expect(queryByRole('button', { name: 'Nachrichten' })).toBeNull();
  });

  it('lists all DM conversations on the messages tab', () => {
    state.conversations = [conv('c1'), conv('c2')];
    stores.__setUrl(new URL('http://localhost/c/inbox?tab=messages'));
    const { getAllByTestId, getByTestId } = render(InboxPage);
    expect(getByTestId('inbox-tab-messages').className).toContain('tab-active');
    expect(getAllByTestId('dm-row')).toHaveLength(2);
  });

  it('messages tab with no conversations shows the empty state', () => {
    stores.__setUrl(new URL('http://localhost/c/inbox?tab=messages'));
    const { getByTestId } = render(InboxPage);
    expect(getByTestId('empty-state')).toBeTruthy();
  });

  it('unknown tab falls back to notifications', () => {
    stores.__setUrl(new URL('http://localhost/c/inbox?tab=bogus'));
    const { getByTestId } = render(InboxPage);
    expect(getByTestId('inbox-tab-notifications').className).toContain('tab-active');
  });

  it('shows the unread DM count on the messages tab', () => {
    state.unreadDm = 4;
    const { getByTestId } = render(InboxPage);
    expect(getByTestId('inbox-tab-messages').textContent).toContain('4');
  });
});
