// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

// The carousel must apply the same "displayable profile" rule as the
// discover communities tab: communities whose kind 0 has no name would
// otherwise render as "Unknown User" cards on the landing page.

const PK_NAMED = 'a'.repeat(64);
const PK_DISPLAY_NAMED = 'b'.repeat(64);
const PK_UNKNOWN = 'c'.repeat(64);
const PK_BLANK_NAME = 'd'.repeat(64);

const state = vi.hoisted(() => ({
  communities: [],
  loaded: false,
  profiles: new Map()
}));

vi.mock('$lib/stores/all-communities.svelte.js', () => ({
  useAllCommunities: () => () => state.communities,
  useAllCommunitiesLoaded: () => () => state.loaded
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => state.profiles
}));
// Embla needs real layout; a no-op action keeps jsdom happy.
vi.mock('embla-carousel-svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/components/CommunikeyCard.svelte', async () => ({
  default: (await import('./stubs/StubPubkeyCard.svelte')).default
}));

import CommunityCarousel from '$lib/components/landing/CommunityCarousel.svelte';

function community(pubkey) {
  return { id: pubkey.slice(0, 8), kind: 10222, pubkey, tags: [], content: '', created_at: 1 };
}

function renderedPubkeys(container) {
  return [...container.querySelectorAll('[data-pubkey]')].map((el) => el.dataset.pubkey);
}

describe('CommunityCarousel', () => {
  beforeEach(() => {
    state.communities = [];
    state.loaded = false;
    state.profiles = new Map();
  });

  it('hides communities without a displayable kind 0 profile', () => {
    state.communities = [
      community(PK_NAMED),
      community(PK_UNKNOWN),
      community(PK_BLANK_NAME),
      community(PK_DISPLAY_NAMED)
    ];
    state.profiles = new Map([
      [PK_NAMED, { name: 'Mathe AG' }],
      [PK_BLANK_NAME, { name: '   ' }],
      [PK_DISPLAY_NAMED, { display_name: 'Physik' }]
    ]);
    state.loaded = true;

    const { container } = render(CommunityCarousel);

    expect(renderedPubkeys(container)).toEqual([PK_NAMED, PK_DISPLAY_NAMED]);
  });

  it('shows the spinner while communities are still loading', () => {
    state.communities = [community(PK_UNKNOWN)];
    state.loaded = false;

    const { container } = render(CommunityCarousel);

    expect(container.querySelector('.loading')).not.toBeNull();
    expect(renderedPubkeys(container)).toEqual([]);
  });

  it('does not spin forever when nothing displayable is left after loading', () => {
    state.communities = [community(PK_UNKNOWN)];
    state.loaded = true;

    const { container } = render(CommunityCarousel);

    expect(container.querySelector('.loading')).toBeNull();
    expect(renderedPubkeys(container)).toEqual([]);
  });
});
