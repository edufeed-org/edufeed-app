// @ts-nocheck
/**
 * ParticipantTile — one LiveKit participant. The Nostr identity is NOT the
 * raw LiveKit identity any more: NIP-29 relays mint `<64-hex>:<suffix>`
 * (one user can be in the room twice), so the parent resolves the pubkey
 * and the tile only ever uses that for avatar, link and hover card.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { profileLink } from '$lib/helpers/nostrUtils';

vi.mock('livekit-client', () => ({
  Track: { Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' } },
  ParticipantEvent: {
    LocalTrackPublished: 'localTrackPublished',
    LocalTrackUnpublished: 'localTrackUnpublished',
    TrackMuted: 'trackMuted',
    TrackUnmuted: 'trackUnmuted',
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed'
  }
}));
vi.mock(
  '$lib/components/shared/ProfileAvatar.svelte',
  () => import('./fixtures/ProfileAvatarStub.svelte')
);
function Stub() {}
vi.mock('$lib/components/shared/ProfileHoverCardContent.svelte', () => ({ default: Stub }));
vi.mock('$lib/paraglide/messages', () => ({
  groups_call_mute: () => 'Mute',
  groups_call_mute_participant: () => 'Mute participant',
  groups_call_unmute_participant: () => 'Unmute participant'
}));

const { default: ParticipantTile } = await import(
  '$lib/components/groups/call/ParticipantTile.svelte'
);

const HEX = 'a'.repeat(64);

function fakeParticipant(identity) {
  return {
    identity,
    sid: 'sid-1',
    getTrackPublication: () => undefined,
    on: vi.fn(),
    off: vi.fn()
  };
}

describe('ParticipantTile', () => {
  it('uses the resolved pubkey, not the raw identity, for avatar and profile link', () => {
    render(ParticipantTile, {
      props: { participant: fakeParticipant(`${HEX}:x1`), pubkey: HEX, isLocal: false }
    });
    const avatars = screen.getAllByTestId('profile-avatar-stub');
    expect(avatars.length).toBeGreaterThan(0);
    for (const avatar of avatars) expect(avatar.getAttribute('data-pubkey')).toBe(HEX);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe(profileLink(HEX));
  });

  it('falls back to the pubkey prefix as the name when no profile is known', () => {
    render(ParticipantTile, {
      props: { participant: fakeParticipant(`${HEX}:x1`), pubkey: HEX, isLocal: false }
    });
    // Rendered twice on purpose: once in the clipped tile, once in the
    // hover-card trigger that sits outside the overflow-hidden box.
    expect(screen.getAllByText(HEX.slice(0, 8)).length).toBeGreaterThan(0);
  });

  it('renders a placeholder without a link when the identity does not resolve to a pubkey', () => {
    render(ParticipantTile, {
      props: { participant: fakeParticipant('anonymous'), pubkey: null, isLocal: false }
    });
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByTestId('profile-avatar-stub')).toBeNull();
  });
});
