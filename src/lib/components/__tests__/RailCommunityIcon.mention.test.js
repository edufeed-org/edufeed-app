/**
 * The rail's community icon carries the "@" pill while one of the
 * community's channels holds an unread mention of you.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const mentioned = vi.hoisted(() => ({ value: false }));
vi.mock('$lib/groups/channel-mentions.svelte.js', () => ({
  useCommunityMention: () => () => mentioned.value
}));
vi.mock('$lib/stores/user-profile.svelte', () => ({
  useUserProfile: () => () => ({ name: 'Edufeed' })
}));

import RailCommunityIcon from '../community/layout/RailCommunityIcon.svelte';

describe('RailCommunityIcon mention pill', () => {
  it('shows the @ pill when a channel of the community mentions you', () => {
    mentioned.value = true;
    render(RailCommunityIcon, { props: { pubkey: 'd'.repeat(64) } });
    expect(screen.getByTestId('concord-mention-pill').textContent).toBe('@');
  });

  it('shows nothing otherwise', () => {
    mentioned.value = false;
    render(RailCommunityIcon, { props: { pubkey: 'd'.repeat(64) } });
    expect(screen.queryByTestId('concord-mention-pill')).toBeNull();
  });
});
