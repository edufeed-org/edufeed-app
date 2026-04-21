/**
 * InboxItem Component Tests - Mark as Read Button
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import InboxItem from '../inbox/InboxItem.svelte';

const mockMarkItemAsRead = vi.fn();

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
  showToast: vi.fn()
}));

vi.mock('$lib/paraglide/messages.js', () => ({
  inbox_action_reaction: () => 'reacted to your post',
  inbox_mark_read: () => 'Mark as read'
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
