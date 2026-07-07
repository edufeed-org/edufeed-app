/**
 * ProfileHoverCardContent Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import ProfileHoverCardContent from '../shared/ProfileHoverCardContent.svelte';

vi.mock('applesauce-core/helpers', () => ({
  getDisplayName: (/** @type {any} */ profile) => profile?.display_name || profile?.name || null
}));

vi.mock('$lib/helpers/nostrUtils.js', () => ({
  hexToNpub: (/** @type {string} */ hex) => (hex ? `npub1${hex.slice(0, 59)}` : null),
  generateAuthorColor: (/** @type {string} */ _hex) => `rgb(128,64,32)`,
  profileLink: (/** @type {string} */ hex) => (hex ? `/p/npub1${hex.slice(0, 59)}` : '#')
}));

vi.mock('$app/paths', () => ({
  resolve: (/** @type {string} */ path) => path
}));

vi.mock('../shared/ImageWithFallback.svelte', async () => {
  return {
    default: (/** @type {any} */ _anchor, /** @type {any} */ _props) => ({})
  };
});

vi.mock('../shared/ProfileAvatar.svelte', async () => {
  return {
    default: (/** @type {any} */ _anchor, /** @type {any} */ _props) => ({})
  };
});

vi.mock('../waves/WaveButton.svelte', async () => {
  return {
    default: (/** @type {any} */ _anchor, /** @type {any} */ _props) => ({})
  };
});

vi.mock('$lib/components/icons', () => ({
  CheckIcon: (/** @type {any} */ _anchor, /** @type {any} */ _props) => ({})
}));

vi.mock('$lib/paraglide/messages', () => ({
  profile_avatar_alt: () => 'Avatar',
  profile_avatar_fallback: () => '?'
}));

vi.mock('$lib/loaders/profile.js', () => ({
  profileLoader: () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) })
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) }),
    replaceable: () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) })
  }
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { fallbackRelays: [] }
}));

vi.mock('applesauce-core/models', () => ({
  ProfileModel: {},
  TimelineModel: {}
}));

vi.mock('$lib/stores/badge-awards.svelte.js', () => ({
  useProfileBadges: () => ({
    getBadges: () => [],
    isLoading: false
  })
}));

vi.mock('$lib/stores/accounts.svelte.js', () => ({
  useActiveUser: () => () => null
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const TEST_PUBKEY = 'a'.repeat(64);

describe('ProfileHoverCardContent', () => {
  it('renders display name from profile', () => {
    const { container } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: { display_name: 'Alice' } }
    });
    expect(container.textContent).toContain('Alice');
  });

  it('shows NIP-05 when profile has nip05', () => {
    const { container } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: { name: 'Alice', nip05: 'alice@example.com' } }
    });
    expect(container.textContent).toContain('alice@example.com');
    // Should NOT show npub when nip05 is present
    const npubText = `npub1${'a'.repeat(59)}`.slice(0, 16);
    expect(container.textContent).not.toContain(npubText);
  });

  it('falls back to npub when no nip05', () => {
    const { container } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: { name: 'Alice' } }
    });
    const npubText = `npub1${'a'.repeat(59)}`.slice(0, 16);
    expect(container.textContent).toContain(npubText);
  });

  it('renders no banner at all when the profile has none set', () => {
    const { container } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: { name: 'Alice' } }
    });
    // Design: the no-banner variant leaves the banner out entirely
    expect(container.querySelector('.h-16')).toBeNull();
  });

  it('truncates bio to 100 chars with ellipsis', () => {
    const longBio = 'x'.repeat(150);
    const { container } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: { name: 'Alice', about: longBio } }
    });
    expect(container.textContent).toContain('x'.repeat(100) + '…');
    expect(container.textContent).not.toContain('x'.repeat(101));
  });

  it('shows full bio when under 100 chars', () => {
    const shortBio = 'A short bio about Alice.';
    const { container } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: { name: 'Alice', about: shortBio } }
    });
    expect(container.textContent).toContain(shortBio);
  });

  it('handles null profile gracefully with pubkey fallback', () => {
    const { container } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: null }
    });
    expect(container.textContent).toContain(TEST_PUBKEY.slice(0, 8));
  });

  it('handles undefined profile gracefully', () => {
    const { container } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY }
    });
    expect(container.textContent).toContain(TEST_PUBKEY.slice(0, 8));
  });

  it('card links to profile page', () => {
    const { container } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: { name: 'Alice' } }
    });
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe(`/p/npub1${TEST_PUBKEY.slice(0, 59)}`);
  });
});
