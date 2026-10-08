// @ts-nocheck
/**
 * LiveKit Connection Service — call roles and server-side mutes.
 *
 * The relay pushes host/co-host roles through participant metadata
 * (RoomService.UpdateParticipant → ParticipantMetadataChanged) and mutes
 * people through RoomService.MutePublishedTrack, which reaches the muted
 * client as TrackMuted on its own publication. The service exposes a
 * metadata version for views to re-derive roles, and keeps its own toggles
 * truthful when the host mutes us.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('livekit-client', () => {
  const RoomEvent = {
    ParticipantConnected: 'participantConnected',
    ParticipantDisconnected: 'participantDisconnected',
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    TrackMuted: 'trackMuted',
    TrackUnmuted: 'trackUnmuted',
    LocalTrackPublished: 'localTrackPublished',
    LocalTrackUnpublished: 'localTrackUnpublished',
    ActiveSpeakersChanged: 'activeSpeakersChanged',
    ParticipantPermissionsChanged: 'participantPermissionsChanged',
    ParticipantMetadataChanged: 'participantMetadataChanged',
    Disconnected: 'disconnected'
  };
  const Track = {
    Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' }
  };

  class MockRoom {
    _handlers = {};
    localParticipant = {
      setMicrophoneEnabled: vi.fn(),
      setCameraEnabled: vi.fn(),
      setScreenShareEnabled: vi.fn(async () => {}),
      activeDeviceMap: new Map(),
      identity: 'local-user',
      metadata: ''
    };
    remoteParticipants = new Map();
    canPlaybackAudio = true;
    async startAudio() {}
    on(event, handler) {
      (this._handlers[event] ??= []).push(handler);
      return this;
    }
    emit(event, ...args) {
      for (const h of this._handlers[event] || []) h(...args);
    }
    async connect() {}
    async disconnect() {}
    static getLocalDevices = vi.fn(async () => []);
  }
  return { Room: MockRoom, RoomEvent, Track };
});

const { RoomEvent, Track } = await import('livekit-client');
const { connectToRoom, disconnectFromRoom, toggleMute, toggleCamera, getLiveKitState } =
  await import('$lib/services/livekit-connection.svelte.js');

describe('call roles via participant metadata', () => {
  beforeEach(async () => {
    await disconnectFromRoom();
  });

  it('bumps participantMetadataVersion and refreshes the participant list on ParticipantMetadataChanged', async () => {
    await connectToRoom('t', 'ws://x');
    const state = getLiveKitState();
    const before = state.participantMetadataVersion;
    const remote = { identity: 'b'.repeat(64) + ':1', metadata: '{}' };
    state.room.remoteParticipants.set(remote.identity, remote);
    remote.metadata = '{"cohost":true}';
    state.room.emit(RoomEvent.ParticipantMetadataChanged, '{}', remote);
    expect(state.participantMetadataVersion).toBe(before + 1);
    expect(state.remoteParticipants).toEqual([remote]);
  });

  it('a server-side mic mute shows as muted, a camera mute as camera off', async () => {
    await connectToRoom('t', 'ws://x');
    const state = getLiveKitState();
    const local = state.room.localParticipant;
    await toggleMute();
    expect(state.isMuted).toBe(false);
    state.room.emit(RoomEvent.TrackMuted, { source: Track.Source.Microphone }, local);
    expect(state.isMuted).toBe(true);

    await toggleCamera();
    expect(state.isCameraOff).toBe(false);
    state.room.emit(RoomEvent.TrackMuted, { source: Track.Source.Camera }, local);
    expect(state.isCameraOff).toBe(true);
  });

  it('a server-side screen share mute stops the share', async () => {
    await connectToRoom('t', 'ws://x');
    const state = getLiveKitState();
    const local = state.room.localParticipant;
    const { toggleScreenShare } = await import('$lib/services/livekit-connection.svelte.js');
    await toggleScreenShare();
    expect(state.isScreenSharing).toBe(true);
    local.setScreenShareEnabled.mockClear();
    state.room.emit(RoomEvent.TrackMuted, { source: Track.Source.ScreenShare }, local);
    expect(state.isScreenSharing).toBe(false);
    expect(local.setScreenShareEnabled).toHaveBeenCalledWith(false);
  });

  it("ignores another participant's track mute for the toggles", async () => {
    await connectToRoom('t', 'ws://x');
    const state = getLiveKitState();
    await toggleMute();
    state.room.emit(
      RoomEvent.TrackMuted,
      { source: Track.Source.Microphone },
      { identity: 'someone-else', isMicrophoneEnabled: false }
    );
    expect(state.isMuted).toBe(false);
  });
});
