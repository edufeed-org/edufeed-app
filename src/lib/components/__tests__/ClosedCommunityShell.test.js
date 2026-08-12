/**
 * ClosedCommunityShell — the non-member landing page for a closed community
 * (concord pointer, no membership pointer — see `deriveCommunityType`).
 *
 * Renders the community's identity (avatar/name/description) plus the
 * closed badge, an explainer, and an owner-contact link. It does NOT render
 * any content tabs — `getCommunityTabs` already restricts the nav to
 * home+settings for this type; this component is what "home" resolves to.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () => ({
  community_type_closed_title: () => 'Closed',
  community_shell_lead: () =>
    'This community is closed. Content and channels are visible only to invited members.',
  community_shell_contact_owner: () => 'Contact the owner',
  community_shell_invite_future: () => 'Joining is invite-only.'
}));

vi.mock('$lib/components/shared/ImageWithFallback.svelte', () => ({
  default: function Stub() {}
}));

import ClosedCommunityShell from '$lib/components/community/views/ClosedCommunityShell.svelte';

const OWNER_HEX = 'a'.repeat(64);

const CLOSED_EVENT = {
  kind: 10222,
  pubkey: OWNER_HEX,
  content: 'A private space for invited members only.',
  tags: [['concord', 'c'.repeat(64), 'wss://concord.example.org']]
};

const PROFILE_EVENT = {
  kind: 0,
  id: 'e'.repeat(64),
  sig: 's'.repeat(128),
  pubkey: OWNER_HEX,
  content: JSON.stringify({ name: 'Secret Society' })
};

describe('ClosedCommunityShell', () => {
  it('renders the closed badge, community identity, and the owner-contact link', () => {
    render(ClosedCommunityShell, {
      props: {
        communikeyEvent: CLOSED_EVENT,
        communityProfile: PROFILE_EVENT
      }
    });

    expect(screen.getByTestId('closed-community-shell')).toBeTruthy();
    expect(screen.getByText('Secret Society')).toBeTruthy();
    expect(screen.getByText('Closed')).toBeTruthy();
    expect(
      screen.getByText(
        'This community is closed. Content and channels are visible only to invited members.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Joining is invite-only.')).toBeTruthy();

    const contactLink = screen.getByRole('link', { name: 'Contact the owner' });
    expect(contactLink).toBeTruthy();
    // /p/<npub> — nip19.npubEncode of the community event's pubkey, not the raw hex.
    expect(contactLink.getAttribute('href')).toMatch(/^\/p\/npub1/);
    expect(contactLink.getAttribute('href')).not.toContain(OWNER_HEX);
  });

  it('falls back to a generic name when no profile event is available', () => {
    render(ClosedCommunityShell, {
      props: {
        communikeyEvent: CLOSED_EVENT,
        communityProfile: null
      }
    });

    expect(screen.getByTestId('closed-community-shell')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Contact the owner' })).toBeTruthy();
  });
});
