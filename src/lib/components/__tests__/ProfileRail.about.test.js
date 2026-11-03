/**
 * ProfileRail's About card renders the kind 0 `about` with clickable links
 * (URLs, nostr: mentions, hashtags) instead of verbatim text.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ path) => path }));
vi.mock('$lib/stores/profile-map.svelte.js', async () => ({
  useProfileMap: (await import('./fixtures/profile-map-mock.svelte.js')).useProfileMap
}));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => undefined
}));
vi.mock('$lib/components/badges/BadgeThumb.svelte', async () => ({
  default: (await import('./fixtures/EmptyStub.svelte')).default
}));
vi.mock('$lib/components/shared/EducatorContextDisplay.svelte', async () => ({
  default: (await import('./fixtures/EmptyStub.svelte')).default
}));

import ProfileRail from '../profile/ProfileRail.svelte';

const PUBKEY = 'a'.repeat(64);

function renderRail(/** @type {string} */ about) {
  return render(ProfileRail, {
    props: {
      pubkey: PUBKEY,
      npub: 'npub1test',
      profile: { name: 'OER Community', about },
      profileEvent: { kind: 0, pubkey: PUBKEY, tags: [], content: '' },
      edufeedValue: null,
      communityPubkeys: [],
      badges: [],
      isOwnProfile: false,
      counts: {},
      onEditProfile: () => {},
      onShowCommunities: () => {},
      onShowBadges: () => {}
    }
  });
}

describe('ProfileRail About', () => {
  it('links the URL in the about text', async () => {
    const { container } = renderRail('Mehr unter https://oer.community/\nBis bald');
    await tick();

    const about = container.querySelector('.pf-about');
    expect(about).toBeTruthy();
    const link = screen.getByRole('link', { name: /oer\.community/ });
    expect(link.getAttribute('href')).toBe('https://oer.community/');
    expect(about?.contains(link)).toBe(true);
    expect(about?.textContent).toContain('\nBis bald');
  });
});
