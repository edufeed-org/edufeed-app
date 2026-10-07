// @ts-nocheck
/**
 * CallParticipantsPanel — the "Teilnehmende (N)" side panel inside a call:
 * one row per participant with avatar, name, mic / camera state, raised
 * hand, guest and listen-only badges, and a row menu carrying the existing
 * per-person actions (pin, local volume) plus whatever the host hands in
 * through `menuExtras` (future host actions — no host logic here).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

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
vi.mock('$lib/components/icons', () => ({
  CloseIcon: Stub,
  MoreIcon: Stub,
  HandIcon: Stub,
  MicIcon: Stub,
  MicOffIcon: Stub,
  VideoIcon: Stub,
  PinIcon: Stub,
  VolumeUpIcon: Stub
}));
vi.mock('$lib/paraglide/messages', () => ({
  groups_call_participants: () => 'Participants',
  groups_call_participants_count: (p) => `Participants (${p.count})`,
  groups_call_participants_close: () => 'Close participant list',
  groups_call_participant_menu: (p) => `Options for ${p.name}`,
  groups_call_mic_off: () => 'Microphone off',
  groups_call_mic_on: () => 'Microphone on',
  groups_call_camera_off: () => 'Camera off',
  groups_call_camera_on_badge: () => 'Camera on',
  groups_call_hand_raised: () => 'Hand raised',
  groups_call_speaking: () => 'Speaking',
  groups_call_guest_badge: () => 'Gast',
  groups_call_listen_only: () => 'Listening only',
  groups_call_tile_you: () => 'You',
  groups_call_pin: () => 'Pin',
  groups_call_unpin: () => 'Unpin',
  groups_call_volume: () => 'Volume',
  groups_call_volume_reset: () => 'Reset volume'
}));

const { default: CallParticipantsPanel } = await import(
  '$lib/components/groups/call/CallParticipantsPanel.svelte'
);
const { default: MenuExtrasHost } = await import(
  './fixtures/CallParticipantsPanelExtrasHost.svelte'
);

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

/** A fake LiveKit participant whose camera state can be flipped live. */
function participant(identity, { camera = false, listeners } = {}) {
  const handlers = new Map();
  return {
    identity,
    sid: `sid-${identity}`,
    camera,
    getTrackPublication: function (source) {
      return source === 'camera' && this.camera ? { track: {}, isMuted: false } : undefined;
    },
    on: vi.fn((evt, cb) => {
      handlers.set(evt, cb);
      listeners?.set(evt, cb);
    }),
    off: vi.fn((evt) => handlers.delete(evt)),
    _emit(evt) {
      handlers.get(evt)?.();
    }
  };
}

function row(identity, pubkey, extra = {}) {
  return {
    key: `seat:${identity}`,
    participant: participant(identity, extra),
    pubkey,
    profile: extra.profile,
    isLocal: false,
    micOff: false,
    speaking: false,
    handRaised: false,
    guest: false,
    listenOnly: false,
    pinned: false,
    volume: 1,
    ...extra
  };
}

const callbacks = () => ({
  onTogglePin: vi.fn(),
  onVolumeChange: vi.fn(),
  onClose: vi.fn()
});

beforeEach(() => vi.clearAllMocks());

describe('CallParticipantsPanel — rows', () => {
  it('lists one row per participant with avatar and name, "You" for the local seat', () => {
    const rows = [
      row(`${A}:me`, A, { isLocal: true }),
      row(`${B}:1`, B, { profile: { name: 'Bea' } }),
      row(`${C}:1`, C)
    ];
    render(CallParticipantsPanel, { props: { rows, ...callbacks() } });
    const items = screen.getAllByTestId('call-participant-row');
    expect(items.map((el) => el.dataset.identity)).toEqual([`${A}:me`, `${B}:1`, `${C}:1`]);
    expect(items[0].textContent).toContain('You');
    expect(items[1].textContent).toContain('Bea');
    // No profile: the pubkey prefix, as on the tiles.
    expect(items[2].textContent).toContain(C.slice(0, 8));
    const avatars = screen.getAllByTestId('profile-avatar-stub');
    expect(avatars.map((a) => a.dataset.pubkey)).toEqual([A, B, C]);
    expect(screen.getByRole('heading', { name: 'Participants (3)' })).toBeTruthy();
  });

  it('shows mic, camera, hand, speaking, guest and listen-only state per row', () => {
    const rows = [
      row(`${B}:1`, B, { micOff: true, handRaised: true, guest: true }),
      row(`${C}:1`, C, { camera: true, speaking: true, listenOnly: true })
    ];
    render(CallParticipantsPanel, { props: { rows, ...callbacks() } });
    const [b, c] = screen.getAllByTestId('call-participant-row');
    expect(b.querySelector('[data-testid="call-participant-mic"]').getAttribute('title')).toBe(
      'Microphone off'
    );
    expect(b.querySelector('[data-testid="call-participant-camera"]').getAttribute('title')).toBe(
      'Camera off'
    );
    expect(b.querySelector('[data-testid="call-participant-hand"]')).toBeTruthy();
    expect(b.querySelector('[data-testid="call-guest-badge"]')).toBeTruthy();
    expect(b.querySelector('[data-testid="call-participant-listen-only"]')).toBeNull();
    expect(b.dataset.speaking).toBe('false');

    expect(c.querySelector('[data-testid="call-participant-mic"]').getAttribute('title')).toBe(
      'Microphone on'
    );
    expect(c.querySelector('[data-testid="call-participant-camera"]').getAttribute('title')).toBe(
      'Camera on'
    );
    expect(c.querySelector('[data-testid="call-participant-hand"]')).toBeNull();
    expect(c.querySelector('[data-testid="call-participant-listen-only"]')).toBeTruthy();
    expect(c.dataset.speaking).toBe('true');
  });

  it('follows the camera live: a camera turned on later flips the badge', async () => {
    const r = row(`${B}:1`, B);
    render(CallParticipantsPanel, { props: { rows: [r], ...callbacks() } });
    const camera = () =>
      screen
        .getByTestId('call-participant-row')
        .querySelector('[data-testid="call-participant-camera"]');
    expect(camera().getAttribute('title')).toBe('Camera off');
    r.participant.camera = true;
    r.participant._emit('trackSubscribed');
    await Promise.resolve();
    expect(camera().getAttribute('title')).toBe('Camera on');
  });

  it('unsubscribes from the participant on unmount', () => {
    const r = row(`${B}:1`, B);
    const { unmount } = render(CallParticipantsPanel, { props: { rows: [r], ...callbacks() } });
    expect(r.participant.on).toHaveBeenCalled();
    unmount();
    expect(r.participant.off).toHaveBeenCalledTimes(r.participant.on.mock.calls.length);
  });

  it('closes through the header button', async () => {
    const cb = callbacks();
    render(CallParticipantsPanel, { props: { rows: [row(`${B}:1`, B)], ...cb } });
    await fireEvent.click(screen.getByRole('button', { name: 'Close participant list' }));
    expect(cb.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('CallParticipantsPanel — row menu', () => {
  it('opens one row menu at a time, named after the person', async () => {
    const rows = [row(`${B}:1`, B, { profile: { name: 'Bea' } }), row(`${C}:1`, C)];
    render(CallParticipantsPanel, { props: { rows, ...callbacks() } });
    const beaMenu = screen.getByRole('button', { name: 'Options for Bea' });
    expect(beaMenu.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(beaMenu);
    expect(beaMenu.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByTestId('call-participant-menu')).toHaveLength(1);
    await fireEvent.click(screen.getByRole('button', { name: `Options for ${C.slice(0, 8)}` }));
    expect(beaMenu.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByTestId('call-participant-menu')).toHaveLength(1);
  });

  it('pins and unpins through the menu', async () => {
    const cb = callbacks();
    const rows = [row(`${B}:1`, B), row(`${C}:1`, C, { pinned: true })];
    render(CallParticipantsPanel, { props: { rows, ...cb } });
    await fireEvent.click(screen.getByRole('button', { name: `Options for ${B.slice(0, 8)}` }));
    await fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    expect(cb.onTogglePin).toHaveBeenCalledWith(`seat:${B}:1`);
    await fireEvent.click(screen.getByRole('button', { name: `Options for ${C.slice(0, 8)}` }));
    await fireEvent.click(screen.getByRole('button', { name: 'Unpin' }));
    expect(cb.onTogglePin).toHaveBeenCalledWith(`seat:${C}:1`);
  });

  it('offers the local volume for remote people only, keyed by pubkey', async () => {
    const cb = callbacks();
    const rows = [row(`${A}:me`, A, { isLocal: true }), row(`${B}:1`, B, { volume: 1.5 })];
    render(CallParticipantsPanel, { props: { rows, ...cb } });
    await fireEvent.click(screen.getByRole('button', { name: 'Options for You' }));
    expect(screen.queryByRole('slider')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: `Options for ${B.slice(0, 8)}` }));
    const slider = screen.getByRole('slider', { name: 'Volume' });
    expect(slider.value).toBe('150');
    await fireEvent.input(slider, { target: { value: '50' } });
    expect(cb.onVolumeChange).toHaveBeenCalledWith(B, 0.5);
    await fireEvent.click(screen.getByRole('button', { name: 'Reset volume' }));
    expect(cb.onVolumeChange).toHaveBeenCalledWith(B, 1);
  });

  it('renders the host-provided extras inside the menu, with the row', async () => {
    const onExtra = vi.fn();
    render(MenuExtrasHost, { props: { rows: [row(`${B}:1`, B)], onExtra } });
    await fireEvent.click(screen.getByRole('button', { name: `Options for ${B.slice(0, 8)}` }));
    await fireEvent.click(screen.getByTestId('menu-extra'));
    expect(onExtra).toHaveBeenCalledWith(`${B}:1`);
  });
});
