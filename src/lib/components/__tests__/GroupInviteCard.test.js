// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * GroupInviteCard — the DM thread's rendering of a group invite: names the
 * community (from its kind 0), offers one real CTA that keeps the `?join=`
 * code, and shows the naddr line for other clients only when it exists.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const COMMUNITY = 'c'.repeat(64);
const profileState = vi.hoisted(() => ({ value: null }));

vi.mock('$lib/paraglide/messages', () => ({
  group_invite_card_label: () => 'Community invitation',
  group_invite_card_body: ({ name }) => `You're invited to join ${name}.`,
  group_invite_card_cta: () => 'Join',
  group_invite_card_other_clients: () => 'For other Nostr clients:',
  common_copy: () => 'Copy',
  common_copied: () => 'Copied'
}));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => profileState.value
}));
vi.mock('$lib/components/shared/ProfileAvatar.svelte', async () => {
  const mock = await import('./__mocks__/EmptyStub.svelte');
  return { default: mock.default };
});

import GroupInviteCard from '$lib/components/dm/GroupInviteCard.svelte';

const invite = {
  communityPubkey: COMMUNITY,
  code: 'hMX6PYy4m37J',
  joinUrl: 'https://dev.edufeed.org/c/npub1xyz?join=hMX6PYy4m37J',
  naddr: 'naddr1qqqq?invite=hMX6PYy4m37J'
};

describe('GroupInviteCard', () => {
  it('names the community and links the CTA to the join URL, code intact', () => {
    profileState.value = { name: 'ALPIKA Grundschule' };
    render(GroupInviteCard, { props: { invite } });
    expect(screen.getByText("You're invited to join ALPIKA Grundschule.")).toBeTruthy();
    const cta = screen.getByTestId('group-invite-cta');
    expect(cta.getAttribute('href')).toBe(invite.joinUrl);
    expect(cta.textContent).toContain('Join');
  });

  it('falls back to a short npub while the profile is unknown', () => {
    profileState.value = null;
    render(GroupInviteCard, { props: { invite } });
    expect(screen.getByText(/You're invited to join npub1/)).toBeTruthy();
  });

  it('shows the naddr line for other clients only when present', () => {
    profileState.value = { name: 'X' };
    const { unmount } = render(GroupInviteCard, { props: { invite } });
    expect(screen.getByTestId('group-invite-naddr').textContent).toContain('nostr:naddr1qqqq');
    unmount();
    render(GroupInviteCard, { props: { invite: { ...invite, naddr: null } } });
    expect(screen.queryByTestId('group-invite-naddr')).toBeNull();
  });
});
