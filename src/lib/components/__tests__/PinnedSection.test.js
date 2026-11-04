// @ts-nocheck
/**
 * PinnedSection Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import PinnedSection from '../community/PinnedSection.svelte';

vi.mock('$lib/paraglide/messages.js', () => ({
  pinned_section_title: () => 'Pinned',
  pinned_edit_pins: () => 'Edit Pins',
  pinned_edit_done: () => 'Done',
  pinned_add_placeholder: () => 'Paste naddr...',
  pinned_add_button: () => 'Add',
  pinned_empty_admin: () => 'Pin content to highlight it here',
  pinned_content_unavailable: () => 'Content unavailable',
  pinned_added_toast: () => 'Pinned!',
  pinned_removed_toast: () => 'Unpinned',
  pinned_reordered_toast: () => 'Reordered',
  pinned_not_found: () => 'Not found',
  pinned_already_pinned: () => 'Already pinned',
  pinned_invalid_identifier: () => 'Invalid identifier'
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: vi.fn(() => ({ subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) })),
    getReplaceable: vi.fn(() => null),
    getEvent: vi.fn(() => null)
  }
}));

vi.mock('$lib/loaders', () => ({
  addressLoader: vi.fn(() => ({ subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) })),
  eventLoader: vi.fn(() => ({ subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) }))
}));

vi.mock('$lib/helpers/feedCardData.js', () => ({
  getFeedCardData: vi.fn(() => ({
    title: 'Test Title',
    typeKey: 'article',
    tags: [],
    description: ''
  }))
}));

vi.mock('$lib/services/pin-list-service.js', () => ({
  pinEvent: vi.fn(),
  unpinEvent: vi.fn(),
  reorderPins: vi.fn(),
  isPinned: vi.fn(() => false)
}));

vi.mock('$lib/helpers/toast.js', () => ({
  showToast: vi.fn()
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: vi.fn(() => ['wss://relay.example.com']),
  getEventLoaderLookupRelays: () => []
}));

vi.mock('nostr-tools', () => ({
  nip19: {
    decode: vi.fn()
  }
}));

const communityPubkey = 'aa'.repeat(32);

describe('PinnedSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when no pins and not admin', () => {
    const { container } = render(PinnedSection, {
      props: { communityId: communityPubkey, isAdmin: false }
    });
    expect(container.textContent).toBe('');
  });

  it('shows empty admin placeholder when admin with no pins', () => {
    render(PinnedSection, {
      props: { communityId: communityPubkey, isAdmin: true }
    });
    expect(screen.getByText('Pin content to highlight it here')).toBeTruthy();
  });

  it('shows Edit Pins button only for admin', () => {
    render(PinnedSection, {
      props: { communityId: communityPubkey, isAdmin: true }
    });
    expect(screen.getByText('Edit Pins')).toBeTruthy();
  });

  it('does not show Edit Pins for non-admin', () => {
    const { container } = render(PinnedSection, {
      props: { communityId: communityPubkey, isAdmin: false }
    });
    expect(container.textContent).not.toContain('Edit Pins');
  });

  it('shows section title when admin', () => {
    render(PinnedSection, {
      props: { communityId: communityPubkey, isAdmin: true }
    });
    expect(screen.getByText('Pinned')).toBeTruthy();
  });

  it('pin cards are full width on phones and fixed tiles from sm up', async () => {
    // A 200px tile alone in a phone column left a narrow card with empty
    // space beside it (laoc, 2026-11-04); phones get full-width cards.
    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');
    /** @type {any} */ (eventStore.model).mockImplementation(() => ({
      subscribe: (/** @type {(v: any) => void} */ cb) => {
        cb([{ id: 'e1' }]);
        return { unsubscribe: vi.fn() };
      }
    }));
    /** @type {any} */ (eventStore.getEvent).mockImplementation((/** @type {string} */ id) =>
      id === 'e1'
        ? { id: 'e1', kind: 30023, created_at: 1, pubkey: 'ab'.repeat(32), tags: [], content: '' }
        : null
    );
    const { container } = render(PinnedSection, {
      props: { communityId: communityPubkey, isAdmin: false }
    });
    const card = /** @type {HTMLElement} */ (container.querySelector('button'));
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('Test Title');
    expect(card.classList.contains('w-full')).toBe(true);
    expect(card.classList.contains('sm:w-[200px]')).toBe(true);
    expect(card.classList.contains('sm:max-w-[240px]')).toBe(true);
    expect(card.classList.contains('w-[200px]')).toBe(false);
  });
});
