// @ts-nocheck
/**
 * GroupCallStage must connect exactly once per mount.
 *
 * Regression (live run 2026-09-25): the mount effect called connectToRoom
 * in its synchronous part; connectToRoom reads AND writes the connection
 * service's `$state` (isConnecting/isConnected/room), so the effect tracked
 * those signals, re-ran on the first write, tore down (aborting the pending
 * connect) and connected again — hundreds of Rooms per minute against the
 * live LiveKit server. This test uses the REAL service with a mocked
 * livekit-client Room, so the reactive coupling is exercised for real.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

const { constructed } = vi.hoisted(() => ({ constructed: { count: 0 } }));

vi.mock('livekit-client', () => {
  const RoomEvent = {
    ParticipantConnected: 'participantConnected',
    ParticipantDisconnected: 'participantDisconnected',
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    LocalTrackPublished: 'localTrackPublished',
    LocalTrackUnpublished: 'localTrackUnpublished',
    ActiveSpeakersChanged: 'activeSpeakersChanged',
    ParticipantPermissionsChanged: 'participantPermissionsChanged',
    Disconnected: 'disconnected'
  };
  const Track = {
    Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' }
  };
  class MockRoom {
    localParticipant = {
      setMicrophoneEnabled: vi.fn(),
      setCameraEnabled: vi.fn(),
      setScreenShareEnabled: vi.fn(),
      activeDeviceMap: new Map(),
      identity: 'local-user',
      permissions: undefined,
      getTrackPublication: () => undefined
    };
    remoteParticipants = new Map();
    constructor() {
      constructed.count++;
    }
    on() {
      return this;
    }
    // Resolves a tick later, like a real signal handshake — long enough for
    // a re-running effect to tear this Room down and build the next one.
    connect() {
      return new Promise((resolve) => setTimeout(resolve, 5));
    }
    async disconnect() {}
    static getLocalDevices = vi.fn(async () => []);
  }
  return { Room: MockRoom, RoomEvent, Track };
});
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
  groups_call_listen_only: () => 'Listening only',
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
  groups_call_screen_share_maximize: () => 'Maximize',
  groups_call_screen_share_minimize: () => 'Minimize',
  common_back: () => 'Back'
}));

const { default: GroupCallStage } = await import(
  '$lib/components/groups/call/GroupCallStage.svelte'
);
const { getLiveKitState } = await import('$lib/services/livekit-connection.svelte.js');

describe('GroupCallStage connects once per mount', () => {
  it('builds exactly one Room even though connectToRoom writes reactive service state', async () => {
    const { unmount } = render(GroupCallStage, {
      props: {
        token: 'jwt',
        serverUrl: 'wss://livekit.example',
        title: 'Standup',
        identityToPubkey: (id) => id.slice(0, 64),
        onLeave: () => {}
      }
    });
    // Let the connect promise settle and any (wrong) effect re-runs fire.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(constructed.count).toBe(1);
    expect(getLiveKitState().isConnected).toBe(true);
    unmount();
  });
});
