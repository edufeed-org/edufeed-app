// @ts-nocheck
/**
 * GroupCallStage — the in-call UI hosted in a channel's stage slot. It is
 * protocol-agnostic: it gets a LiveKit token + server url and connects,
 * disconnects when it unmounts, and hides publish controls for a
 * listen-only token. Who minted the token (NIP-29 relay today, a CORD-07
 * broker later) is not its business.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const { lk, acquireRoom, releaseRoom, disconnectFromRoom } = vi.hoisted(() => ({
  lk: {
    isConnected: true,
    isConnecting: false,
    isMuted: false,
    isCameraOff: true,
    isScreenSharing: false,
    canPublish: true,
    localParticipant: null,
    remoteParticipants: [],
    room: null,
    speakingParticipantIds: new Set(),
    audioInputDevices: [],
    activeAudioDeviceId: '',
    audioOutputDevices: [],
    activeAudioOutputDeviceId: '',
    videoInputDevices: [],
    activeVideoDeviceId: ''
  },
  acquireRoom: vi.fn(async () => {}),
  releaseRoom: vi.fn(async () => {}),
  disconnectFromRoom: vi.fn(async () => {})
}));

vi.mock('$lib/services/livekit-connection.svelte.js', () => ({
  acquireRoom,
  releaseRoom,
  disconnectFromRoom,
  toggleMute: (/** @type {any[]} */ ...a) => media.toggleMute(...a),
  toggleCamera: (/** @type {any[]} */ ...a) => media.toggleCamera(...a),
  toggleScreenShare: (/** @type {any[]} */ ...a) => media.toggleScreenShare(...a),
  refreshAudioDevices: vi.fn(),
  switchAudioDevice: vi.fn(),
  switchAudioOutputDevice: vi.fn(),
  refreshVideoDevices: vi.fn(),
  switchVideoDevice: vi.fn(),
  getLiveKitState: () => lk
}));
const media = vi.hoisted(() => ({
  toggleMute: vi.fn(async () => {}),
  toggleCamera: vi.fn(async () => {}),
  toggleScreenShare: vi.fn(async () => {}),
  showToast: vi.fn(),
  playLeaveSound: vi.fn()
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
vi.mock('$lib/components/groups/call/ParticipantTile.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/icons', () => ({
  MeetIcon: Stub,
  ChevronDownIcon: Stub,
  VolumeUpIcon: Stub
}));
vi.mock('$lib/paraglide/messages', () => ({
  groups_call_leave: () => 'Leave call',
  groups_call_connecting: () => 'Connecting…',
  groups_call_connection_error: () => 'Could not connect',
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
  groups_call_screen_share_active: (/** @type {any} */ p) => `${p.name} is sharing`,
  groups_call_screen_share_maximize: () => 'Maximize',
  groups_call_screen_share_minimize: () => 'Minimize',
  common_back: () => 'Back',
  groups_call_error_mic_denied: () => 'Microphone access denied',
  groups_call_error_mic_missing: () => 'No microphone',
  groups_call_error_camera_denied: () => 'Camera access denied',
  groups_call_error_camera_missing: () => 'No camera',
  groups_call_error_device_busy: () => 'Device busy',
  groups_call_error_screen_denied: () => 'Screen capture blocked',
  groups_call_error_media_generic: () => 'Media failed'
}));

const { default: GroupCallStage } = await import(
  '$lib/components/groups/call/GroupCallStage.svelte'
);

const baseProps = {
  token: 'jwt-token',
  serverUrl: 'wss://livekit.example',
  title: 'Standup',
  identityToPubkey: (/** @type {string} */ id) => id.slice(0, 64),
  onLeave: vi.fn()
};

beforeEach(() => {
  acquireRoom.mockClear();
  releaseRoom.mockClear();
  disconnectFromRoom.mockClear();
  baseProps.onLeave.mockClear();
  lk.isConnected = true;
  lk.isConnecting = false;
  lk.canPublish = true;
});

describe('GroupCallStage', () => {
  it('joins with the token and server url it is handed, muted and camera off', async () => {
    render(GroupCallStage, { props: baseProps });
    await Promise.resolve();
    expect(acquireRoom).toHaveBeenCalledWith('jwt-token', 'wss://livekit.example', {});
  });

  it('hides the camera button for an audio-only call', () => {
    render(GroupCallStage, { props: { ...baseProps, video: false } });
    expect(screen.queryByTitle('Camera on')).toBeNull();
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

  it('plays the leave cue when leaving', async () => {
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByRole('button', { name: 'Leave call' }));
    expect(media.playLeaveSound).toHaveBeenCalledTimes(1);
  });

  it('releases its claim on the call when unmounted (a twin may still hold it)', async () => {
    const { unmount } = render(GroupCallStage, { props: baseProps });
    await Promise.resolve();
    unmount();
    expect(releaseRoom).toHaveBeenCalledWith('jwt-token');
    expect(disconnectFromRoom).not.toHaveBeenCalled();
  });

  it('shows the title and the publish controls for a normal token', () => {
    render(GroupCallStage, { props: baseProps });
    expect(screen.getByText('Standup')).toBeTruthy();
    expect(screen.getByTitle('Mute')).toBeTruthy();
    expect(screen.getByTitle('Camera on')).toBeTruthy();
    expect(screen.getByTitle('Share screen')).toBeTruthy();
    expect(screen.queryByText('You are listening only')).toBeNull();
  });

  it('hides mic/camera/screen controls and shows a hint for a listen-only token', () => {
    lk.canPublish = false;
    render(GroupCallStage, { props: baseProps });
    expect(screen.queryByTitle('Mute')).toBeNull();
    expect(screen.queryByTitle('Camera on')).toBeNull();
    expect(screen.queryByTitle('Share screen')).toBeNull();
    expect(screen.getByText('You are listening only')).toBeTruthy();
  });

  it('leave button disconnects and calls onLeave', async () => {
    render(GroupCallStage, { props: baseProps });
    await fireEvent.click(screen.getByRole('button', { name: 'Leave call' }));
    expect(disconnectFromRoom).toHaveBeenCalledTimes(1);
    expect(baseProps.onLeave).toHaveBeenCalledTimes(1);
  });

  it('renders inside the stage layout', () => {
    render(GroupCallStage, { props: baseProps });
    expect(screen.getByTestId('group-call-stage')).toBeTruthy();
  });
});
