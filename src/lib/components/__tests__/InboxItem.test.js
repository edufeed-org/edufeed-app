/**
 * InboxItem Component Tests - Mark as Read Button
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import InboxItem from '../inbox/InboxItem.svelte';

const mockMarkItemAsRead = vi.fn();
const mockMuteUser = vi.fn(/** @param {string} _pubkey */ (_pubkey) => Promise.resolve());
const mockShowToast = vi.fn();

// Mock app-settings before any imports that transitively depend on it
vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: { debugMode: false, gatedMode: false }
}));

vi.mock('$lib/services/inbox-service.svelte.js', () => ({
  markItemAsRead: (/** @type {any[]} */ ...args) => mockMarkItemAsRead(...args)
}));

vi.mock('$lib/helpers/inbox.js', () => ({
  getNotificationType: () => 'reaction',
  getNotificationUrl: () => '/some/url'
}));

vi.mock('$lib/helpers/waves.js', () => ({
  publishWave: vi.fn()
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { replaceable: () => ({ subscribe: vi.fn() }) },
  pool: { request: vi.fn() }
}));

vi.mock('$lib/helpers/toast', () => ({
  showToast: (/** @type {any[]} */ ...args) => mockShowToast(...args)
}));

vi.mock('$lib/stores/mute-list.svelte.js', () => ({
  muteUser: (/** @type {string} */ pubkey) => mockMuteUser(pubkey),
  initializeMuteList: vi.fn(),
  cleanupMuteList: vi.fn()
}));

vi.mock('$lib/paraglide/messages.js', () => ({
  inbox_action_reaction: () => 'reacted to your post',
  inbox_action_reply: () => 'replied',
  inbox_action_comment: () => 'commented',
  inbox_action_mention: () => 'mentioned you',
  inbox_action_note_mention: () => 'mentioned you in a note',
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

vi.mock('$app/paths', () => ({
  resolve: (/** @type {string} */ path) => path
}));

const mockEvent = {
  id: 'event-123',
  kind: 7,
  pubkey: 'aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344',
  tags: [],
  created_at: Math.floor(Date.now() / 1000) - 60,
  content: '+',
  sig: 'mock-sig'
};

describe('InboxItem mark-as-read button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows mark-as-read button when unread', () => {
    render(InboxItem, {
      props: { event: mockEvent, unread: true }
    });
    const btn = screen.getByRole('button', { name: 'Mark as read' });
    expect(btn).toBeTruthy();
  });

  it('does not show mark-as-read button when read', () => {
    render(InboxItem, {
      props: { event: mockEvent, unread: false }
    });
    const btn = screen.queryByRole('button', { name: 'Mark as read' });
    expect(btn).toBeNull();
  });

  it('calls markItemAsRead when dot is clicked', async () => {
    render(InboxItem, {
      props: { event: mockEvent, unread: true }
    });
    const btn = screen.getByRole('button', { name: 'Mark as read' });
    btn.click();
    expect(mockMarkItemAsRead).toHaveBeenCalledWith('event-123');
  });

  it('does not trigger link navigation when dot is clicked', async () => {
    render(InboxItem, {
      props: { event: mockEvent, unread: true }
    });
    const btn = screen.getByRole('button', { name: 'Mark as read' });
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    btn.dispatchEvent(clickEvent);
    // markItemAsRead should only be called once (from button, not from link's handleClick)
    expect(mockMarkItemAsRead).toHaveBeenCalledTimes(1);
  });
});

describe('InboxItem block menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a three-dot menu trigger', () => {
    const { container } = render(InboxItem, {
      props: { event: mockEvent, unread: false }
    });
    const trigger = screen.getByRole('button', { name: 'Notification options' });
    expect(trigger).toBeTruthy();
    expect(container.querySelector('[popover]')).toBeTruthy();
  });

  it('keeps the block action inside the menu instead of the row', () => {
    render(InboxItem, {
      props: { event: mockEvent, unread: false }
    });
    const blockBtn = screen.getByRole('button', { name: 'Block' });
    expect(blockBtn.closest('[popover]')).not.toBeNull();
  });

  it('labels the block action simply "Block"', () => {
    render(InboxItem, {
      props: { event: mockEvent, unread: false }
    });
    expect(screen.queryByRole('button', { name: 'Block sender' })).toBeNull();
  });

  it('mutes the sender when the block action is clicked', () => {
    render(InboxItem, {
      props: { event: mockEvent, unread: false }
    });
    screen.getByRole('button', { name: 'Block' }).click();
    expect(mockMuteUser).toHaveBeenCalledWith(mockEvent.pubkey);
  });

  it('does not navigate when the block action is clicked', () => {
    render(InboxItem, {
      props: { event: mockEvent, unread: false }
    });
    const blockBtn = screen.getByRole('button', { name: 'Block' });
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    blockBtn.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true);
  });

  it('confirms with a success toast once the sender is muted', async () => {
    render(InboxItem, {
      props: { event: mockEvent, unread: false }
    });
    screen.getByRole('button', { name: 'Block' }).click();
    await vi.waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('blocked', 'success'));
  });

  it('does not navigate when the menu trigger is clicked', () => {
    render(InboxItem, {
      props: { event: mockEvent, unread: false }
    });
    const trigger = screen.getByRole('button', { name: 'Notification options' });
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    trigger.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true);
  });
});
