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

const { lk, connectToRoom, disconnectFromRoom } = vi.hoisted(() => ({
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
  connectToRoom: vi.fn(async () => {}),
  disconnectFromRoom: vi.fn(async () => {})
}));

vi.mock('$lib/services/livekit-connection.svelte.js', () => ({
  connectToRoom,
  disconnectFromRoom,
  toggleMute: vi.fn(),
  toggleCamera: vi.fn(),
  toggleScreenShare: vi.fn(),
  refreshAudioDevices: vi.fn(),
  switchAudioDevice: vi.fn(),
  switchAudioOutputDevice: vi.fn(),
  refreshVideoDevices: vi.fn(),
  switchVideoDevice: vi.fn(),
  getLiveKitState: () => lk
}));
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
  common_back: () => 'Back'
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
  connectToRoom.mockClear();
  disconnectFromRoom.mockClear();
  baseProps.onLeave.mockClear();
  lk.isConnected = true;
  lk.isConnecting = false;
  lk.canPublish = true;
});

describe('GroupCallStage', () => {
  it('connects with the token and server url it is handed, video on by default', async () => {
    render(GroupCallStage, { props: baseProps });
    await Promise.resolve();
    expect(connectToRoom).toHaveBeenCalledWith('jwt-token', 'wss://livekit.example', {
      video: true,
      audio: true
    });
  });

  it('passes video: false through', async () => {
    render(GroupCallStage, { props: { ...baseProps, video: false } });
    await Promise.resolve();
    expect(connectToRoom.mock.calls[0][2]).toEqual({ video: false, audio: true });
  });

  it('disconnects when unmounted', async () => {
    const { unmount } = render(GroupCallStage, { props: baseProps });
    await Promise.resolve();
    unmount();
    expect(disconnectFromRoom).toHaveBeenCalledTimes(1);
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
