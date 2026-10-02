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
import { render, screen, fireEvent } from '@testing-library/svelte';
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
  groups_call_mic_off: () => 'Microphone off',
  groups_call_hand_raised: () => 'Hand raised',
  groups_call_volume: () => 'Volume',
  groups_call_volume_reset: () => 'Reset volume',
  groups_call_pin: () => 'Pin',
  groups_call_unpin: () => 'Unpin',
  groups_call_guest_badge: () => 'Gast',
  groups_call_tile_you: () => 'Du'
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

  it('never plays audio itself: remote audio is attached centrally by the call service', () => {
    const { container } = render(ParticipantTile, {
      props: { participant: fakeParticipant(`${HEX}:x1`), pubkey: HEX }
    });
    expect(container.querySelector('audio')).toBeNull();
  });

  it('shows a mic-off badge and a raised hand', () => {
    render(ParticipantTile, {
      props: {
        participant: fakeParticipant(`${HEX}:x1`),
        pubkey: HEX,
        isMicOff: true,
        handRaised: true
      }
    });
    expect(screen.getByTitle('Microphone off')).toBeTruthy();
    expect(screen.getByTitle('Hand raised')).toBeTruthy();
  });

  it('shows a Gast badge for a participant who joined through a call link', () => {
    render(ParticipantTile, {
      props: { participant: fakeParticipant(`${HEX}:x1`), pubkey: HEX, isGuest: true }
    });
    const badge = screen.getByTestId('call-guest-badge');
    expect(badge.textContent).toContain('Gast');
  });

  it('shows no Gast badge for a regular member', () => {
    render(ParticipantTile, {
      props: { participant: fakeParticipant(`${HEX}:x1`), pubkey: HEX }
    });
    expect(screen.queryByTestId('call-guest-badge')).toBeNull();
  });

  it('floats reactions sent from this seat', () => {
    render(ParticipantTile, {
      props: {
        participant: fakeParticipant(`${HEX}:x1`),
        pubkey: HEX,
        reactions: [{ id: 'r1', identity: `${HEX}:x1`, emoji: '🎉' }]
      }
    });
    expect(screen.getByText('🎉')).toBeTruthy();
  });

  it('per-person volume: the slider shows percent and reports 0..2', async () => {
    const onVolumeChange = vi.fn();
    render(ParticipantTile, {
      props: { participant: fakeParticipant(`${HEX}:x1`), pubkey: HEX, volume: 0.5, onVolumeChange }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Volume' }));
    const slider = screen.getByRole('slider');
    expect(slider.value).toBe('50');
    await fireEvent.input(slider, { target: { value: '150' } });
    expect(onVolumeChange).toHaveBeenLastCalledWith(1.5);
    await fireEvent.click(screen.getByRole('button', { name: 'Reset volume' }));
    expect(onVolumeChange).toHaveBeenLastCalledWith(1);
  });

  it('has no volume control on the local tile', () => {
    render(ParticipantTile, {
      props: {
        participant: fakeParticipant(`${HEX}:x1`),
        pubkey: HEX,
        isLocal: true,
        onVolumeChange: vi.fn()
      }
    });
    expect(screen.queryByRole('button', { name: 'Volume' })).toBeNull();
  });

  it('pins and unpins the tile', async () => {
    const onTogglePin = vi.fn();
    const { rerender } = render(ParticipantTile, {
      props: { participant: fakeParticipant(`${HEX}:x1`), pubkey: HEX, onTogglePin }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    expect(onTogglePin).toHaveBeenCalledTimes(1);
    await rerender({
      participant: fakeParticipant(`${HEX}:x1`),
      pubkey: HEX,
      onTogglePin,
      pinned: true
    });
    expect(screen.getByRole('button', { name: 'Unpin' })).toBeTruthy();
  });

  // QA round 2 K-new-1: the own tile said "You" in the German UI.
  it('labels the own tile in the UI language', () => {
    render(ParticipantTile, {
      props: { participant: fakeParticipant(`${HEX}:x1`), pubkey: HEX, isLocal: true }
    });
    expect(screen.getByText('Du')).toBeTruthy();
    expect(screen.queryByText('You')).toBeNull();
  });
});
