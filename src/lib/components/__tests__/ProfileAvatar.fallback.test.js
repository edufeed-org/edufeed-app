/**
 * ProfileAvatar broken-picture fallback tests
 * Renders the REAL ImageWithFallback (not mocked) to exercise the chain.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ProfileAvatar from '../shared/ProfileAvatar.svelte';

vi.mock('applesauce-core/helpers', () => ({
  getProfilePicture: () => 'https://img.example/broken.jpg',
  getDisplayName: () => 'Silberengel'
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    profile: () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) })
  }
}));

vi.mock('$lib/paraglide/messages', () => ({
  profile_avatar_alt: () => 'Avatar',
  profile_avatar_fallback: () => '?'
}));

vi.mock('$app/paths', () => ({
  resolve: (/** @type {string} */ path) => path
}));

vi.mock('$lib/helpers/nostrUtils.js', () => ({
  profileLink: (/** @type {string} */ pubkey) => (pubkey ? `/p/${pubkey}` : '#')
}));

vi.mock('../shared/HoverCard.svelte', async () => {
  const mock = await import('./__mocks__/HoverCardMock.svelte');
  return { default: mock.default };
});

vi.mock('../shared/ProfileHoverCardContent.svelte', () => ({
  default: function StubProfileHoverCardContent() {}
}));

const PROFILE = { picture: 'https://img.example/broken.jpg' };

describe('ProfileAvatar with a broken picture URL', () => {
  it("default ('initial') type: ends at the initial letter, never robohash", async () => {
    const { container } = render(ProfileAvatar, {
      props: { pubkey: 'abc123', profile: PROFILE }
    });
    // stage 0: proxied URL
    let img = container.querySelector('img');
    expect(img).not.toBeNull();
    await fireEvent.error(img);
    // stage 1: original URL
    img = container.querySelector('img');
    expect(img?.src).toBe('https://img.example/broken.jpg');
    await fireEvent.error(img);
    // exhausted → initial letter of the display name
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('S');
  });

  it("'robohash' type: tries robohash, then the initial letter", async () => {
    const { container } = render(ProfileAvatar, {
      props: { pubkey: 'abc123', profile: PROFILE, fallbackType: 'robohash' }
    });
    await fireEvent.error(container.querySelector('img')); // proxy → original
    await fireEvent.error(container.querySelector('img')); // original → robohash
    const img = container.querySelector('img');
    expect(img?.src).toContain('robohash.org');
    await fireEvent.error(img); // robohash → initial letter
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('S');
  });
});
