// @ts-nocheck
/**
 * EventContextMenu Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { BehaviorSubject } from 'rxjs';
import EventContextMenu from '../shared/EventContextMenu.svelte';

const mockShowToast = vi.fn();
const mockEncodeEventToNaddr = vi.fn(() => 'naddr1test123');

vi.mock('$lib/helpers/toast.js', () => ({
  showToast: (/** @type {any[]} */ ...args) => mockShowToast(...args)
}));

vi.mock('$lib/helpers/nostrUtils.js', () => ({
  encodeEventToNaddr: (/** @type {any[]} */ ...args) => mockEncodeEventToNaddr(...args)
}));

vi.mock('$lib/paraglide/messages.js', () => ({
  event_menu_copy_event_id: () => 'Copy event ID',
  event_menu_copy_link: () => 'Copy link',
  event_menu_view_raw_event: () => 'View raw event',
  event_menu_raw_event_title: () => 'Raw Event',
  event_menu_event_id_copied: () => 'Event ID copied!',
  event_menu_share_link_copied: () => 'Link copied!',
  event_menu_share_to_communities: () => 'Share to communities',
  event_menu_feature_on_homepage: () => 'Feature on homepage',
  event_menu_remove_from_homepage: () => 'Remove from homepage',
  event_menu_featured_toast: () => 'Featured on homepage!',
  event_menu_unfeatured_toast: () => 'Removed from homepage',
  common_copy: () => 'Copy',
  common_copied: () => 'Copied',
  common_close: () => 'Close'
}));

vi.mock('$lib/services/pin-list-service.js', () => ({
  pinEvent: vi.fn().mockResolvedValue(undefined),
  unpinEvent: vi.fn().mockResolvedValue(undefined),
  isPinned: vi.fn(() => false)
}));

const ACTIVE_USER_PUBKEY = 'aa'.repeat(32);

// Default: logged-in user
let mockActiveUser = { pubkey: ACTIVE_USER_PUBKEY };

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => mockActiveUser
}));

// Track the replaceable subject so tests can control what eventStore emits
let replaceableSubject = new BehaviorSubject(undefined);

const mockReplaceable = vi.fn();

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    replaceable: (...args) => mockReplaceable(...args)
  }
}));

vi.mock('$lib/components/icons', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual };
});

// Mock CommunityShare component
vi.mock('../shared/CommunityShare.svelte', () => ({ default: () => ({}) }));

const mockEvent = {
  id: 'abc123',
  kind: 30023,
  pubkey: 'aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344',
  tags: [['d', 'test-article']],
  created_at: 1700000000,
  content: 'Hello world'
};

describe('EventContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveUser = { pubkey: ACTIVE_USER_PUBKEY };
    // Reset subject and mock implementation after clearAllMocks
    replaceableSubject = new BehaviorSubject(undefined);
    mockReplaceable.mockImplementation(() => replaceableSubject);

    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });
    // jsdom doesn't implement showModal/close on <dialog>
    HTMLDialogElement.prototype.showModal =
      HTMLDialogElement.prototype.showModal ||
      vi.fn(function () {
        this.setAttribute('open', '');
      });
    HTMLDialogElement.prototype.close =
      HTMLDialogElement.prototype.close ||
      vi.fn(function () {
        this.removeAttribute('open');
      });
  });

  it('renders the three-dots menu button', () => {
    render(EventContextMenu, { props: { event: mockEvent } });
    const button = screen.getByRole('button', { name: 'Event menu' });
    expect(button).toBeTruthy();
  });

  it('displays renamed menu items with correct labels', () => {
    render(EventContextMenu, { props: { event: mockEvent } });
    expect(screen.getByText('Copy link')).toBeTruthy();
    expect(screen.getByText('Copy event ID')).toBeTruthy();
    expect(screen.getByText('View raw event')).toBeTruthy();
  });

  it('shows "Share to communities" menu item when user is logged in', () => {
    render(EventContextMenu, { props: { event: mockEvent } });
    const dropdown = document.querySelector('.dropdown-content');
    const buttons = Array.from(dropdown?.querySelectorAll('button') || []);
    const shareBtn = buttons.find((btn) => btn.textContent?.includes('Share to communities'));
    expect(shareBtn).toBeTruthy();
  });

  it('hides "Share to communities" menu item when not logged in', () => {
    mockActiveUser = null;
    render(EventContextMenu, { props: { event: mockEvent } });
    const dropdown = document.querySelector('.dropdown-content');
    const buttons = Array.from(dropdown?.querySelectorAll('button') || []);
    const shareBtn = buttons.find((btn) => btn.textContent?.includes('Share to communities'));
    expect(shareBtn).toBeUndefined();
  });

  it('opens share modal when "Share to communities" is clicked', async () => {
    render(EventContextMenu, { props: { event: mockEvent } });

    const dropdown = document.querySelector('.dropdown-content');
    const buttons = Array.from(dropdown?.querySelectorAll('button') || []);
    const shareBtn = buttons.find((btn) => btn.textContent?.includes('Share to communities'));
    await fireEvent.click(shareBtn);

    // The share dialog should have the open attribute after showModal
    const dialogs = document.querySelectorAll('dialog');
    const shareDialog = Array.from(dialogs).find((d) =>
      d.querySelector('h3')?.textContent?.includes('Share to communities')
    );
    expect(shareDialog?.hasAttribute('open')).toBe(true);
  });

  it('has a divider separating user and dev actions', () => {
    render(EventContextMenu, { props: { event: mockEvent } });
    const divider = document.querySelector('.divider');
    expect(divider).toBeTruthy();
  });

  it('copies njump share link on Copy link click', async () => {
    render(EventContextMenu, { props: { event: mockEvent } });

    await fireEvent.click(screen.getByText('Copy link'));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://njump.me/naddr1test123');
    expect(mockShowToast).toHaveBeenCalledWith('Link copied!', 'success');
  });

  it('copies naddr to clipboard on Copy event ID click', async () => {
    render(EventContextMenu, { props: { event: mockEvent } });

    await fireEvent.click(screen.getByText('Copy event ID'));

    expect(mockEncodeEventToNaddr).toHaveBeenCalledWith(mockEvent);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('naddr1test123');
    expect(mockShowToast).toHaveBeenCalledWith('Event ID copied!', 'success');
  });

  it('opens raw event modal with JSON content', async () => {
    render(EventContextMenu, { props: { event: mockEvent } });

    await fireEvent.click(screen.getByText('View raw event'));

    expect(screen.getByText('Raw Event')).toBeTruthy();
    const pre = document.querySelector('pre');
    expect(pre?.textContent).toContain('"id": "abc123"');
    expect(pre?.textContent).toContain('"kind": 30023');
  });

  describe('feature on homepage (pin)', () => {
    it('shows "Feature on homepage" when active user has kind 10222 in EventStore', async () => {
      replaceableSubject = new BehaviorSubject({ kind: 10222, pubkey: ACTIVE_USER_PUBKEY });
      mockReplaceable.mockImplementation(() => replaceableSubject);

      render(EventContextMenu, { props: { event: mockEvent } });
      await vi.waitFor(() => {
        expect(screen.getByText('Feature on homepage')).toBeTruthy();
      });
    });

    it('hides feature option when active user has no kind 10222', () => {
      render(EventContextMenu, { props: { event: mockEvent } });
      expect(screen.queryByText('Feature on homepage')).toBeNull();
    });

    it('uses activeUser.pubkey for isPinned lookup', async () => {
      replaceableSubject = new BehaviorSubject({ kind: 10222, pubkey: ACTIVE_USER_PUBKEY });
      mockReplaceable.mockImplementation(() => replaceableSubject);

      const { isPinned } = await import('$lib/services/pin-list-service.js');
      isPinned.mockReturnValue(false);

      render(EventContextMenu, { props: { event: mockEvent } });

      await vi.waitFor(() => {
        expect(screen.getByText('Feature on homepage')).toBeTruthy();
      });

      expect(isPinned).toHaveBeenCalledWith(mockEvent, ACTIVE_USER_PUBKEY);
    });

    it('shows "Remove from homepage" when event is already pinned', async () => {
      replaceableSubject = new BehaviorSubject({ kind: 10222, pubkey: ACTIVE_USER_PUBKEY });
      mockReplaceable.mockImplementation(() => replaceableSubject);

      const { isPinned } = await import('$lib/services/pin-list-service.js');
      isPinned.mockReturnValue(true);

      render(EventContextMenu, { props: { event: mockEvent } });

      await vi.waitFor(() => {
        expect(screen.getByText('Remove from homepage')).toBeTruthy();
      });
    });

    it('subscribes to eventStore.replaceable with kind 10222 and active user pubkey', () => {
      render(EventContextMenu, { props: { event: mockEvent } });

      expect(mockReplaceable).toHaveBeenCalledWith(10222, ACTIVE_USER_PUBKEY);
    });
  });
});
