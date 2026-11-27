// @ts-nocheck
/** @vitest-environment jsdom */
// /c/inbox has two segments: Benachrichtigungen (default) and Nachrichten
// (?tab=messages, the DM conversation list). The phone dock links here instead
// of carrying a separate Nachrichten item.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const state = vi.hoisted(() => ({
  notifications: [],
  conversations: [],
  unread: 0,
  unreadDm: 0,
  strangers: 0,
  strangerNotifications: []
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
  getStrangerFollowerCount: () => state.strangers,
  getStrangerNotifications: () => state.strangerNotifications,
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
// A stub that renders an element, so rows can be counted.
vi.mock('$lib/components/inbox/InboxItem.svelte', async () => ({
  default: (await import('./__mocks__/DmRowStub.svelte')).default
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
  dm_no_conversations: () => 'Noch keine Unterhaltungen',
  inbox_tab_notifications: () => 'Benachrichtigungen',
  inbox_tab_messages: () => 'Nachrichten',
  inbox_filter_all: () => 'Alle',
  inbox_filter_forms: () => 'Formulare',
  inbox_filter_reactions: () => 'Reaktionen',
  inbox_filter_waves: () => 'Winker',
  inbox_filter_comments: () => 'Kommentare',
  inbox_filter_replies: () => 'Antworten',
  inbox_filter_mentions: () => 'Erwähnungen',
  inbox_filter_rsvps: () => 'RSVPs',
  inbox_stranger_followers: ({ count }) => `${count} weitere neue Follower`,
  inbox_stranger_notifications: ({ count }) => `${count} von unbekannten Konten`,
  inbox_stranger_notifications_show: () => 'anzeigen',
  inbox_stranger_notifications_hide: () => 'ausblenden'
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
    state.strangers = 0;
    state.strangerNotifications = [];
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

  it('messages tab with no conversations shows the conversations empty state', () => {
    stores.__setUrl(new URL('http://localhost/c/inbox?tab=messages'));
    const { getByTestId } = render(InboxPage);
    expect(getByTestId('empty-state').textContent).toContain('Noch keine Unterhaltungen');
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

  it('counts new followers outside the network in one line, without names or links', () => {
    const { queryByTestId, unmount } = render(InboxPage);
    expect(queryByTestId('inbox-stranger-followers')).toBeNull();
    unmount();
    state.strangers = 3;
    const { getByTestId } = render(InboxPage);
    const line = getByTestId('inbox-stranger-followers');
    expect(line.textContent).toContain('3 weitere neue Follower');
    expect(line.querySelector('a')).toBeNull();
  });

  it('folds notifications from unknown accounts into one line and shows them on click', async () => {
    const reply = (id) => ({
      id,
      kind: 1,
      pubkey: 'c'.repeat(64),
      created_at: 5,
      tags: [],
      content: ''
    });
    state.strangerNotifications = [reply('s1'), reply('s2')];
    const { getByTestId, queryByTestId, getByRole } = render(InboxPage);
    expect(getByTestId('inbox-stranger-notifications').textContent).toContain(
      '2 von unbekannten Konten'
    );
    expect(queryByTestId('inbox-list')).toBeNull();
    await fireEvent.click(getByRole('button', { name: 'anzeigen' }));
    expect(getByTestId('inbox-list').children).toHaveLength(2);
    await fireEvent.click(getByRole('button', { name: 'ausblenden' }));
    expect(queryByTestId('inbox-list')).toBeNull();
  });

  it('shows no unknown-accounts line without any, nor on the messages tab', () => {
    const { queryByTestId, unmount } = render(InboxPage);
    expect(queryByTestId('inbox-stranger-notifications')).toBeNull();
    unmount();
    state.strangerNotifications = [
      { id: 's1', kind: 1, pubkey: 'c'.repeat(64), created_at: 5, tags: [], content: '' }
    ];
    stores.__setUrl(new URL('http://localhost/c/inbox?tab=messages'));
    expect(render(InboxPage).queryByTestId('inbox-stranger-notifications')).toBeNull();
  });

  it('shows no stranger-follower line on the messages tab', () => {
    state.strangers = 3;
    stores.__setUrl(new URL('http://localhost/c/inbox?tab=messages'));
    const { queryByTestId } = render(InboxPage);
    expect(queryByTestId('inbox-stranger-followers')).toBeNull();
  });
});
