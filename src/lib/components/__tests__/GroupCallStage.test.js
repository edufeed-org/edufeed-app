// @ts-nocheck
/**
 * GroupCallStage — the in-call UI hosted in a channel's stage slot. A pure
 * view: the call store owns the connection (so the call survives leaving
 * the channel), so mounting/unmounting never connects or disconnects. It
 * registers itself as an on-screen view, hides publish controls for a
 * listen-only token, and carries the call controls: mic/camera/screen with
 * their menus, raise hand, reactions, reconnect bar and spotlight.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const { lk, svc, media } = vi.hoisted(() => ({
  lk: {
    isConnected: true,
    isConnecting: false,
    isMuted: false,
    isCameraOff: true,
    isScreenSharing: false,
    canPublish: true,
    canSignal: true,
    connectionState: 'connected',
    localParticipant: null,
    remoteParticipants: [],
    mutedIdentities: new Set(),
    raisedHands: new Set(),
    reactions: [],
    room: null,
    speakingParticipantIds: new Set(),
    audioInputDevices: [],
    activeAudioDeviceId: '',
    audioOutputDevices: [],
    activeAudioOutputDeviceId: '',
    videoInputDevices: [],
    activeVideoDeviceId: ''
  },
  svc: {
    connectToRoom: vi.fn(),
    disconnectFromRoom: vi.fn(async () => {}),
    setHandRaised: vi.fn(async () => {}),
    sendReaction: vi.fn(async () => {}),
    setAudioProcessingLive: vi.fn(async () => {}),
    setParticipantVolume: vi.fn((_pk, v) => v),
    canSelectSpeaker: vi.fn(() => false),
    refreshAudioDevices: vi.fn(),
    refreshVideoDevices: vi.fn()
  },
  media: {
    toggleMute: vi.fn(async () => {}),
    toggleCamera: vi.fn(async () => {}),
    toggleScreenShare: vi.fn(async () => {}),
    showToast: vi.fn(),
    playLeaveSound: vi.fn()
  }
}));

vi.mock('$lib/services/livekit-connection.svelte.js', () => ({
  CALL_REACTIONS: ['👍', '🎉'],
  connectToRoom: svc.connectToRoom,
  disconnectFromRoom: svc.disconnectFromRoom,
  toggleMute: (...a) => media.toggleMute(...a),
  toggleCamera: (...a) => media.toggleCamera(...a),
  toggleScreenShare: (...a) => media.toggleScreenShare(...a),
  refreshAudioDevices: svc.refreshAudioDevices,
  switchAudioDevice: vi.fn(),
  switchAudioOutputDevice: vi.fn(),
  refreshVideoDevices: svc.refreshVideoDevices,
  switchVideoDevice: vi.fn(),
  setParticipantVolume: svc.setParticipantVolume,
  setAudioProcessingLive: svc.setAudioProcessingLive,
  canSelectSpeaker: svc.canSelectSpeaker,
  setHandRaised: svc.setHandRaised,
  sendReaction: svc.sendReaction,
  getLiveKitState: () => lk
}));
vi.mock('$lib/helpers/toast', () => ({ showToast: media.showToast }));
vi.mock('$lib/services/call-sounds.js', () => ({ playLeaveSound: media.playLeaveSound }));
vi.mock('livekit-client', () => ({
  Track: { Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' } }
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));
function Stub() {}
vi.mock(
  '$lib/components/groups/call/ParticipantTile.svelte',
  () => import('./fixtures/ParticipantTileStub.svelte')
);
vi.mock('$lib/components/groups/call/ScreenShareTile.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/icons', () => ({
  MeetIcon: Stub,
  ChevronDownIcon: Stub,
  MicIcon: Stub,
  MicOffIcon: Stub,
  VideoIcon: Stub,
  ScreenShareIcon: Stub,
  HandIcon: Stub,
  SmilePlusIcon: Stub,
  ChatIcon: Stub,
  ExternalLinkIcon: Stub,
  LinkIcon: Stub
}));
vi.mock('$lib/paraglide/messages', () => ({
  groups_call_leave: () => 'Leave call',
  groups_call_connecting: () => 'Connecting…',
  groups_call_listen_only: () => 'You are listening only',
  groups_call_mute: () => 'Mute',
  groups_call_unmute: () => 'Unmute',
  groups_call_camera_on: () => 'Camera on',
  groups_call_camera_off: () => 'Camera off',
  groups_call_select_microphone: () => 'Select microphone',
  groups_call_select_speaker: () => 'Select speaker',
  groups_call_select_camera: () => 'Select camera',
  groups_call_unknown_device: () => 'Unknown device',
  groups_call_screen_share_start: () => 'Share screen',
  groups_call_screen_share_stop: () => 'Stop sharing',
  groups_call_screen_share_you: () => 'You are sharing',
  groups_call_screen_share_active: (p) => `${p.name} is sharing`,
  groups_call_screen_share_quality: () => 'Sharing quality',
  groups_call_screen_share_options: () => 'Screen options',
  groups_call_camera_options: () => 'Camera options',
  groups_call_mic_options: () => 'Mic options',
  groups_call_audio_processing: () => 'Audio processing',
  groups_call_noise_suppression: () => 'Noise suppression',
  groups_call_echo_cancellation: () => 'Echo cancellation',
  groups_call_auto_gain: () => 'Automatic volume',
  groups_call_reconnecting: () => 'Reconnecting…',
  groups_call_raise_hand: () => 'Raise hand',
  groups_call_lower_hand: () => 'Lower hand',
  groups_call_hands_raised: (p) => `${p.count} raised`,
  groups_call_react: () => 'React',
  groups_call_show_chat: () => 'Chat',
  groups_call_pop_out: () => 'Pop out',
  groups_call_pop_in: () => 'Back to tab',
  groups_call_invite_title: () => 'Invite guests',
  groups_call_invite_button: () => 'Invite link',
  groups_call_error_mic_denied: () => 'Microphone access denied',
  groups_call_error_mic_missing: () => 'No microphone',
  groups_call_error_camera_denied: () => 'Camera access denied',
  groups_call_error_camera_missing: () => 'No camera',
  groups_call_error_device_busy: () => 'Device busy',
  groups_call_error_screen_denied: () => 'Screen capture blocked',
  groups_call_error_media_generic: () => 'Media failed'
}));

// bind:clientWidth measures through ResizeObserver, which jsdom lacks; an
// unmeasured stage falls back to the CSS grid, which is what we assert on.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { default: GroupCallStage } = await import(
  '$lib/components/groups/call/GroupCallStage.svelte'
);

const HEX = 'b'.repeat(64);
const baseProps = {
  title: 'Standup',
  identityToPubkey: (id) => id.slice(0, 64),
  onLeave: vi.fn()
};

function remote(identity, { screenShare = false, metadata } = {}) {
  return {
    identity,
    sid: `sid-${identity}`,
    metadata,
    getTrackPublication: (source) =>
      screenShare && source === 'screen_share' ? { track: { sid: 'ss' } } : undefined
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Object.assign(lk, {
    isConnected: true,
    isConnecting: false,
    isMuted: false,
    canPublish: true,
    canSignal: true,
    connectionState: 'connected',
    localParticipant: { identity: `${'a'.repeat(64)}:me`, getTrackPublication: () => undefined },
    remoteParticipants: [],
    raisedHands: new Set(),
    reactions: []
  });
});

describe('GroupCallStage — a view, not the connection owner', () => {
  it('never connects or disconnects on mount / unmount', () => {
    const { unmount } = render(GroupCallStage, { props: baseProps });
    unmount();
    expect(svc.connectToRoom).not.toHaveBeenCalled();
    expect(svc.disconnectFromRoom).not.toHaveBeenCalled();
  });

  it('registers itself as an on-screen view while mounted', () => {
    const off = vi.fn();
    const registerView = vi.fn(() => off);
    const { unmount } = render(GroupCallStage, { props: { ...baseProps, registerView } });
    expect(registerView).toHaveBeenCalledTimes(1);
    unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });

  // Regression (live 2026-09-28, effect_update_depth_exceeded on join): the
  // REAL register reads and writes the store's `$state` counter; called
  // tracked inside the mount effect it re-ran the effect forever.
  it('registers with the real call store without an effect loop', async () => {
    const { registerCallStageView, getGroupCallState } = await import(
      '$lib/groups/group-call.svelte.js'
    );
    const { unmount } = render(GroupCallStage, {
      props: { ...baseProps, registerView: () => registerCallStageView('/x') }
    });
    await Promise.resolve();
    expect(getGroupCallState().stageViews).toBe(1);
    unmount();
    expect(getGroupCallState().stageViews).toBe(0);
  });

  it('leave plays the cue and hands the leave to the parent', async () => {
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByRole('button', { name: 'Leave call' }));
    expect(media.playLeaveSound).toHaveBeenCalledTimes(1);
    expect(baseProps.onLeave).toHaveBeenCalledTimes(1);
    expect(svc.disconnectFromRoom).not.toHaveBeenCalled();
  });

  it('offers a way back to the chat while staying in the call', async () => {
    const onShowChat = vi.fn();
    render(GroupCallStage, { props: { ...baseProps, onShowChat } });
    await fireEvent.click(screen.getByTestId('group-call-show-chat'));
    expect(onShowChat).toHaveBeenCalledTimes(1);
  });

  it('marks the chat button pressed while the chat is open beside the stage', () => {
    render(GroupCallStage, { props: { ...baseProps, onShowChat: vi.fn(), chatOpen: true } });
    expect(screen.getByTestId('group-call-show-chat').getAttribute('aria-pressed')).toBe('true');
  });

  it('offers the pop-out window only when the parent can open one', async () => {
    const { unmount } = render(GroupCallStage, { props: baseProps });
    expect(screen.queryByTestId('group-call-pop-out')).toBeNull();
    unmount();
    const onPopOut = vi.fn();
    render(GroupCallStage, { props: { ...baseProps, onPopOut } });
    await fireEvent.click(screen.getByRole('button', { name: 'Pop out' }));
    expect(onPopOut).toHaveBeenCalledTimes(1);
  });

  it('inside the pop-out: a way back to the tab', async () => {
    const onPopIn = vi.fn();
    render(GroupCallStage, { props: { ...baseProps, onPopIn } });
    await fireEvent.click(screen.getByRole('button', { name: 'Back to tab' }));
    expect(onPopIn).toHaveBeenCalledTimes(1);
  });

  it('offers Einladungslink only when the parent passes onInvite', async () => {
    const { unmount } = render(GroupCallStage, { props: baseProps });
    expect(screen.queryByTestId('group-call-invite')).toBeNull();
    unmount();
    const onInvite = vi.fn();
    render(GroupCallStage, { props: { ...baseProps, onInvite } });
    await fireEvent.click(screen.getByTestId('group-call-invite'));
    expect(onInvite).toHaveBeenCalled();
  });

  // The pop-out is another document: menus must close on clicks in the
  // document the stage is rendered in, not only the opener's.
  it('closes an open menu on a click outside it', async () => {
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByTitle('React'));
    expect(screen.getByTestId('group-call-reactions')).toBeTruthy();
    await fireEvent.pointerDown(screen.getByTestId('group-call-stage'));
    expect(screen.queryByTestId('group-call-reactions')).toBeNull();
  });

  it('renders inside the stage layout with the title', () => {
    render(GroupCallStage, { props: baseProps });
    expect(screen.getByTestId('group-call-stage')).toBeTruthy();
    expect(screen.getByText('Standup')).toBeTruthy();
  });
});

describe('publish controls', () => {
  it('shows mic, camera and screen for a normal token', () => {
    render(GroupCallStage, { props: baseProps });
    expect(screen.getByTitle('Mute')).toBeTruthy();
    expect(screen.getByTitle('Camera on')).toBeTruthy();
    expect(screen.getByTitle('Share screen')).toBeTruthy();
    expect(screen.queryByText('You are listening only')).toBeNull();
  });

  it('hides the camera button for an audio-only call', () => {
    render(GroupCallStage, { props: { ...baseProps, video: false } });
    expect(screen.queryByTitle('Camera on')).toBeNull();
  });

  it('listen-only: no mic/camera/screen, a hint, but hands and reactions stay', () => {
    lk.canPublish = false;
    render(GroupCallStage, { props: baseProps });
    expect(screen.queryByTitle('Mute')).toBeNull();
    expect(screen.queryByTitle('Camera on')).toBeNull();
    expect(screen.queryByTitle('Share screen')).toBeNull();
    expect(screen.getByText('You are listening only')).toBeTruthy();
    expect(screen.getByTitle('Raise hand')).toBeTruthy();
  });

  it('toasts why the microphone could not be enabled', async () => {
    media.toggleMute.mockRejectedValueOnce(
      Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
    );
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByTitle('Mute'));
    await Promise.resolve();
    expect(media.showToast).toHaveBeenCalledWith('Microphone access denied', 'error');
  });

  it('the mic menu toggles audio processing live', async () => {
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByRole('button', { name: 'Mic options' }));
    expect(svc.refreshAudioDevices).toHaveBeenCalled();
    const toggle = screen.getByRole('checkbox', { name: 'Noise suppression' });
    expect(toggle.checked).toBe(true);
    await fireEvent.click(toggle);
    expect(svc.setAudioProcessingLive).toHaveBeenCalledWith({ noiseSuppression: false });
  });

  it('only lists speakers where the output can actually be chosen', async () => {
    lk.audioOutputDevices = [{ deviceId: 'spk', label: 'Headphones' }];
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByRole('button', { name: 'Mic options' }));
    expect(screen.queryByText('Select speaker')).toBeNull();
    lk.audioOutputDevices = [];
  });

  it('picks and remembers a screen share quality', async () => {
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByRole('button', { name: 'Screen options' }));
    await fireEvent.click(screen.getByRole('button', { name: '720p · 15 fps' }));
    expect(localStorage.getItem('edufeed:call:screenShareQuality')).toBe('720p15');
  });
});

describe('hands, reactions, connection state', () => {
  it('raises and lowers my hand', async () => {
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByTitle('Raise hand'));
    expect(svc.setHandRaised).toHaveBeenCalledWith(true);
  });

  it('shows my hand as raised and lowers it', async () => {
    lk.raisedHands = new Set([lk.localParticipant.identity]);
    render(GroupCallStage, { props: baseProps });
    expect(screen.getByTestId('group-call-hands').textContent).toContain('1 raised');
    await fireEvent.click(screen.getByTitle('Lower hand'));
    expect(svc.setHandRaised).toHaveBeenCalledWith(false);
  });

  it('sends a reaction from the picker', async () => {
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByTitle('React'));
    await fireEvent.click(screen.getByRole('button', { name: '🎉' }));
    expect(svc.sendReaction).toHaveBeenCalledWith('🎉');
    expect(screen.queryByTestId('group-call-reactions')).toBeNull();
  });

  it('no hands or reactions when the token cannot send data', () => {
    lk.canSignal = false;
    render(GroupCallStage, { props: baseProps });
    expect(screen.queryByTitle('Raise hand')).toBeNull();
    expect(screen.queryByTitle('React')).toBeNull();
  });

  it('shows a reconnecting bar while the connection recovers', () => {
    lk.connectionState = 'reconnecting';
    render(GroupCallStage, { props: baseProps });
    expect(screen.getByTestId('group-call-reconnecting')).toBeTruthy();
  });
});

describe('layout', () => {
  it('everyone in an auto-fit grid when nothing is spotlighted', () => {
    lk.remoteParticipants = [remote(`${HEX}:x1`)];
    render(GroupCallStage, { props: baseProps });
    expect(screen.getByTestId('group-call-grid')).toBeTruthy();
    expect(screen.getByTestId(`call-item-seat:${HEX}:x1`)).toBeTruthy();
    expect(screen.queryByTestId('group-call-spotlight')).toBeNull();
  });

  it('tiles start at the top of the video area, not centred in a tall box', () => {
    // laoc 2026-10-01: in a tall channel the centred grid sat far below the
    // header (and below the fold while the page itself grew).
    lk.remoteParticipants = [remote(`${HEX}:x1`)];
    render(GroupCallStage, { props: baseProps });
    const grid = screen.getByTestId('group-call-grid');
    expect(grid.classList.contains('content-start')).toBe(true);
    expect(grid.classList.contains('content-center')).toBe(false);
    const layer = grid.parentElement;
    expect(layer.classList.contains('items-start')).toBe(true);
    expect(layer.classList.contains('items-center')).toBe(false);
  });

  it('the control bar never shrinks away: the video area gives way instead', () => {
    render(GroupCallStage, { props: baseProps });
    const controls = screen.getByTestId('group-call-controls');
    expect(controls.classList.contains('shrink-0')).toBe(true);
    const videoArea = screen.getByTestId('group-call-grid').parentElement.parentElement;
    expect(videoArea.classList.contains('min-h-0')).toBe(true);
    expect(videoArea.classList.contains('flex-1')).toBe(true);
  });

  it('the header shrinks with the stage, not the viewport: labels collapse to icons', () => {
    // laoc 2026-10-02: beside the chat column the stage is narrow even on a
    // wide window; the header's fixed button row widened the page. The stage
    // is a size container and the labels answer to ITS width.
    render(GroupCallStage, {
      props: { ...baseProps, onShowChat: vi.fn(), onInvite: vi.fn(), onPopOut: vi.fn() }
    });
    const stage = screen.getByTestId('group-call-stage');
    expect(stage.classList.contains('@container')).toBe(true);
    for (const id of ['group-call-invite', 'group-call-show-chat']) {
      const label = screen.getByTestId(id).querySelector('span');
      expect(label.classList.contains('hidden')).toBe(true);
      expect(label.classList.contains('@md:inline')).toBe(true);
    }
    // The title side gives way (truncates) before the buttons do.
    const title = stage.querySelector('h2');
    expect(title.classList.contains('truncate')).toBe(true);
    expect(title.parentElement.classList.contains('min-w-0')).toBe(true);
    expect(title.parentElement.classList.contains('flex-1')).toBe(true);
  });

  it('a remote screen share takes the spotlight, seats move to the strip', () => {
    lk.remoteParticipants = [remote(`${HEX}:x1`, { screenShare: true })];
    render(GroupCallStage, { props: baseProps });
    expect(screen.getByTestId('group-call-spotlight')).toBeTruthy();
    expect(screen.getByTestId(`call-item-screen:${HEX}:x1`)).toBeTruthy();
    expect(screen.getByTestId(`call-item-seat:${HEX}:x1`)).toBeTruthy();
  });

  it('marks guests who joined through a call link', () => {
    const GUEST = 'b'.repeat(64);
    const MEMBER = 'c'.repeat(64);
    lk.remoteParticipants = [
      remote(`${GUEST}:1`, { metadata: '{"guest":true,"pass":"p"}' }),
      remote(`${MEMBER}:1`)
    ];
    render(GroupCallStage, { props: baseProps });
    const guestTile = screen
      .getByTestId(`call-item-seat:${GUEST}:1`)
      .querySelector('[data-testid="participant-tile-stub"]');
    const memberTile = screen
      .getByTestId(`call-item-seat:${MEMBER}:1`)
      .querySelector('[data-testid="participant-tile-stub"]');
    expect(guestTile.getAttribute('data-guest')).toBe('true');
    expect(memberTile.getAttribute('data-guest')).toBe('false');
  });
});
