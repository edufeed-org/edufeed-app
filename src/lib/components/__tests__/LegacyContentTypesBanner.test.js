// @ts-nocheck
/**
 * LegacyContentTypesBanner — owner-only nudge shown on community pages when
 * the kind 10222 definition predates the ["strict", "content"] marker.
 * Legacy definitions fail open (all tabs shown), so the owner should re-save
 * their content-type settings to activate filtering.
 *
 * Visible ONLY when ALL hold:
 *  - a community event is loaded and lacks the ["strict", "content"] marker
 *  - the active user is the community owner (pubkey match)
 *  - legacy-content-banner-dismissed:<communityPubkey> is not set
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const mockActiveUser = vi.hoisted(() => ({ value: null }));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => mockActiveUser.value
}));
vi.mock('$lib/stores/accounts.svelte.js', () => ({
  useActiveUser: () => () => mockActiveUser.value
}));

const mockOpenModal = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: { openModal: mockOpenModal }
}));
const mockGoto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto: mockGoto }));

vi.mock('$lib/paraglide/messages', () =>
  Object.fromEntries(
    [
      'community_legacy_content_banner_title',
      'community_legacy_content_banner_text',
      'community_legacy_content_banner_review',
      'community_legacy_content_banner_dismiss'
    ].map((key) => [key, () => key])
  )
);

import LegacyContentTypesBanner from '../community/LegacyContentTypesBanner.svelte';

const OWNER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const SEL = '[data-testid="legacy-content-banner"]';

function legacyEvent(pubkey = OWNER) {
  return {
    kind: 10222,
    pubkey,
    tags: [
      ['r', 'wss://relay.example.com'],
      ['content', 'Calendar'],
      ['k', '31923']
    ]
  };
}

function strictEvent(pubkey = OWNER) {
  const event = legacyEvent(pubkey);
  event.tags.push(['strict', 'content']);
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockActiveUser.value = { pubkey: OWNER };
});

describe('LegacyContentTypesBanner', () => {
  it('renders for the owner when the definition lacks the strict marker', () => {
    const { container } = render(LegacyContentTypesBanner, {
      props: { communityEvent: legacyEvent() }
    });
    expect(container.querySelector(SEL)).not.toBeNull();
  });

  it('renders nothing when the definition already carries the marker', () => {
    const { container } = render(LegacyContentTypesBanner, {
      props: { communityEvent: strictEvent() }
    });
    expect(container.querySelector(SEL)).toBeNull();
  });

  it('renders nothing without a community event', () => {
    const { container } = render(LegacyContentTypesBanner, {
      props: { communityEvent: null }
    });
    expect(container.querySelector(SEL)).toBeNull();
  });

  it('renders nothing for non-owners', () => {
    mockActiveUser.value = { pubkey: OTHER };
    const { container } = render(LegacyContentTypesBanner, {
      props: { communityEvent: legacyEvent() }
    });
    expect(container.querySelector(SEL)).toBeNull();
  });

  it('renders nothing when logged out', () => {
    mockActiveUser.value = null;
    const { container } = render(LegacyContentTypesBanner, {
      props: { communityEvent: legacyEvent() }
    });
    expect(container.querySelector(SEL)).toBeNull();
  });

  it('review button navigates to the settings page (inline basics form)', async () => {
    const event = legacyEvent();
    const { container } = render(LegacyContentTypesBanner, {
      props: { communityEvent: event }
    });
    await fireEvent.click(container.querySelector('[data-testid="legacy-content-banner-review"]'));
    expect(mockGoto).toHaveBeenCalledWith('?view=settings');
  });

  it('dismiss hides the banner and persists per community', async () => {
    const { container } = render(LegacyContentTypesBanner, {
      props: { communityEvent: legacyEvent() }
    });
    await fireEvent.click(container.querySelector('[data-testid="legacy-content-banner-dismiss"]'));
    expect(container.querySelector(SEL)).toBeNull();
    expect(localStorage.getItem(`legacy-content-banner-dismissed:${OWNER}`)).toBeTruthy();
  });

  it('stays hidden when previously dismissed', () => {
    localStorage.setItem(`legacy-content-banner-dismissed:${OWNER}`, '1');
    const { container } = render(LegacyContentTypesBanner, {
      props: { communityEvent: legacyEvent() }
    });
    expect(container.querySelector(SEL)).toBeNull();
  });

  it('a dismissal for one community does not hide another', () => {
    localStorage.setItem(`legacy-content-banner-dismissed:${OTHER}`, '1');
    const { container } = render(LegacyContentTypesBanner, {
      props: { communityEvent: legacyEvent() }
    });
    expect(container.querySelector(SEL)).not.toBeNull();
  });
});
