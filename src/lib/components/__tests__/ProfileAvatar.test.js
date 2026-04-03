/**
 * ProfileAvatar Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import ProfileAvatar from '../shared/ProfileAvatar.svelte';

// Mock dependencies
vi.mock('applesauce-core/models', () => ({
  ProfileModel: {}
}));

vi.mock('applesauce-core/helpers', () => ({
  getProfilePicture: () => undefined,
  getDisplayName: () => 'Test User'
}));

vi.mock('$lib/loaders/profile.js', () => ({
  profileLoader: () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) })
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) })
  }
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { fallbackRelays: [] }
}));

vi.mock('$lib/paraglide/messages', () => ({
  profile_avatar_alt: () => 'Avatar',
  profile_avatar_fallback: () => '?'
}));

vi.mock('$app/paths', () => ({
  resolve: (/** @type {string} */ path) => path
}));

vi.mock('../shared/ImageWithFallback.svelte', () => ({
  default: {}
}));

vi.mock('../shared/HoverCard.svelte', () => ({
  default: {}
}));

vi.mock('../shared/ProfileHoverCardContent.svelte', () => ({
  default: {}
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const TEST_PUBKEY = 'abc123def456';

describe('ProfileAvatar', () => {
  describe('linkToProfile prop', () => {
    it('does not render an <a> tag by default', () => {
      const { container } = render(ProfileAvatar, { props: { pubkey: TEST_PUBKEY } });
      const link = container.querySelector('a');
      expect(link).toBeNull();
    });

    it('does not render an <a> tag when linkToProfile is false', () => {
      const { container } = render(ProfileAvatar, {
        props: { pubkey: TEST_PUBKEY, linkToProfile: false }
      });
      const link = container.querySelector('a');
      expect(link).toBeNull();
    });

    it('renders an <a> tag when linkToProfile is true and showHoverCard is false', () => {
      const { container } = render(ProfileAvatar, {
        props: { pubkey: TEST_PUBKEY, linkToProfile: true, showHoverCard: false }
      });
      const link = container.querySelector('a');
      expect(link).not.toBeNull();
      expect(link?.getAttribute('href')).toBe(`/p/${TEST_PUBKEY}`);
    });

    it('does not render an <a> tag when linkToProfile is true but pubkey is missing', () => {
      const { container } = render(ProfileAvatar, {
        props: { linkToProfile: true }
      });
      const link = container.querySelector('a');
      expect(link).toBeNull();
    });
  });
});
