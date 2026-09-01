// @ts-nocheck
/**
 * HomeInboxCard Component Tests — Concord invite CTA row
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import HomeInboxCard from '../inbox/HomeInboxCard.svelte';

const mockGetPendingInviteCount = vi.fn(() => 0);
const mockOpenModal = vi.fn();

function StubComponent() {}

vi.mock('$app/navigation', () => ({
  goto: vi.fn()
}));

vi.mock('$app/paths', () => ({
  resolve: (/** @type {string} */ path) => path
}));

vi.mock('$lib/services/inbox-service.svelte.js', () => ({
  getNotifications: () => [],
  getUnreadCount: () => 0,
  markAsRead: vi.fn(),
  isNotificationUnread: () => false
}));

// The widget must render the KNOWN bucket, never the raw list: request
// conversations (strangers — the botrift-style rotating-pubkey spam) stay
// quiet everywhere outside the DM view's requests folder.
const dmLists = vi.hoisted(() => ({
  /** @type {any[]} */ raw: [],
  /** @type {any[]} */ known: []
}));

vi.mock('$lib/services/dm-service.svelte.js', () => ({
  getDmConversations: () => dmLists.raw,
  getKnownDmConversations: () => dmLists.known,
  getUnreadDmCount: () => 0,
  isDmConversationUnread: () => true
}));

vi.mock('$lib/helpers/inbox.js', () => ({
  filterNotificationsByType: (/** @type {any[]} */ items) => items
}));

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => undefined
}));

vi.mock('$lib/components/icons', () => ({
  BellIcon: StubComponent,
  ChevronRightIcon: StubComponent
}));

vi.mock('../inbox/InboxItem.svelte', () => ({ default: StubComponent }));
vi.mock('../inbox/InboxDmItem.svelte', () => import('./fixtures/InboxDmItemStub.svelte'));

vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: { openModal: (/** @type {any[]} */ ...args) => mockOpenModal(...args) }
}));

vi.mock('$lib/concord/pending-invites.svelte.js', () => ({
  getPendingInviteCount: (/** @type {any[]} */ ...args) => mockGetPendingInviteCount(...args)
}));

vi.mock('$lib/paraglide/messages.js', () => ({
  inbox_title: () => 'Inbox',
  home_inbox_new_pill: ({ count }) => `${count} new`,
  inbox_mark_all_read: () => 'Mark all read',
  inbox_view_all: () => 'View all',
  inbox_filter_all: () => 'All',
  inbox_filter_messages: () => 'Messages',
  inbox_filter_reactions: () => 'Reactions',
  inbox_filter_comments: () => 'Comments',
  inbox_filter_replies: () => 'Replies',
  inbox_filter_mentions: () => 'Mentions',
  inbox_filter_rsvps: () => 'RSVPs',
  inbox_empty: () => 'Nothing here',
  home_inbox_empty_filtered: ({ filter }) => `Nothing for ${filter}`,
  concord_invite_inbox_cta: ({ count }) => `${count} invitation(s) to private areas`,
  concord_invite_inbox_action: () => 'View'
}));

describe('HomeInboxCard Concord invite CTA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the invite CTA row when there are pending invites', () => {
    mockGetPendingInviteCount.mockReturnValue(2);
    render(HomeInboxCard);
    const cta = screen.getByTestId('invite-inbox-cta');
    expect(cta.textContent).toContain('2 invitation(s) to private areas');
    expect(cta.textContent).toContain('View');
  });

  it('opens the concordInvites modal when the CTA is clicked', async () => {
    mockGetPendingInviteCount.mockReturnValue(2);
    render(HomeInboxCard);
    const cta = screen.getByTestId('invite-inbox-cta');
    await fireEvent.click(cta);
    expect(mockOpenModal).toHaveBeenCalledWith('concordInvites');
  });

  it('does not render the CTA row when there are no pending invites', () => {
    mockGetPendingInviteCount.mockReturnValue(0);
    render(HomeInboxCard);
    expect(screen.queryByTestId('invite-inbox-cta')).toBeNull();
  });
});

describe('HomeInboxCard DM list', () => {
  const conv = (/** @type {string} */ id) => ({
    id,
    participants: ['a'.repeat(64)],
    lastMessage: { created_at: 1000, content: 'hi' }
  });

  beforeEach(() => {
    mockGetPendingInviteCount.mockReturnValue(0);
    dmLists.raw = [conv('spam-from-stranger'), conv('friend-chat')];
    dmLists.known = [conv('friend-chat')];
  });

  // Regression: the widget used the RAW conversation list, so a stranger's
  // spam DM (botrift-style rotating pubkeys — never matched by pubkey mutes)
  // showed as a loud unread row on the dashboard (laoc, 2026-09-01).
  it('renders only KNOWN conversations — requests stay off the dashboard', () => {
    render(HomeInboxCard);
    const rows = screen.getAllByTestId('dm-item').map((el) => el.textContent);
    expect(rows).toEqual(['friend-chat']);
  });
});
