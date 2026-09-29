// @ts-nocheck
/**
 * LiveKit Connection Service — publish permission.
 *
 * NIP-29 relays hand a non-member of a public group a listen-only token
 * (canPublish=false). The service must expose that so the in-call UI hides
 * mic/camera/screen controls, and it must not try to publish tracks the
 * server would refuse.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const holders = { permissions: undefined };

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
    _handlers = {};
    localParticipant = {
      setMicrophoneEnabled: vi.fn(),
      setCameraEnabled: vi.fn(),
      setScreenShareEnabled: vi.fn(),
      activeDeviceMap: new Map(),
      identity: 'local-user',
      permissions: holders.permissions
    };
    remoteParticipants = new Map();
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

const { RoomEvent } = await import('livekit-client');
const { connectToRoom, disconnectFromRoom, toggleMute, toggleCamera, getLiveKitState } =
  await import('$lib/services/livekit-connection.svelte.js');

describe('canPublish', () => {
  beforeEach(async () => {
    await disconnectFromRoom();
    holders.permissions = undefined;
  });

  it('defaults to true when the server states no permissions', async () => {
    await connectToRoom('t', 'ws://x');
    const state = getLiveKitState();
    expect(state.canPublish).toBe(true);
    expect(state.room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
  });

  it('is false for a listen-only token and skips publishing the microphone', async () => {
    holders.permissions = { canPublish: false, canSubscribe: true };
    await connectToRoom('t', 'ws://x', { video: true });
    const state = getLiveKitState();
    expect(state.canPublish).toBe(false);
    expect(state.room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(state.room.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
  });

  it('makes toggleMute and toggleCamera no-ops while listen-only', async () => {
    holders.permissions = { canPublish: false };
    await connectToRoom('t', 'ws://x');
    const state = getLiveKitState();
    await toggleMute();
    await toggleCamera();
    expect(state.room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(state.room.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
  });

  it('follows a ParticipantPermissionsChanged for the local participant', async () => {
    holders.permissions = { canPublish: false };
    await connectToRoom('t', 'ws://x');
    const state = getLiveKitState();
    const local = state.room.localParticipant;
    local.permissions = { canPublish: true };
    state.room.emit(RoomEvent.ParticipantPermissionsChanged, { canPublish: false }, local);
    expect(state.canPublish).toBe(true);
  });

  it('ignores a ParticipantPermissionsChanged for a remote participant', async () => {
    holders.permissions = { canPublish: false };
    await connectToRoom('t', 'ws://x');
    const state = getLiveKitState();
    state.room.emit(
      RoomEvent.ParticipantPermissionsChanged,
      { canPublish: false },
      { identity: 'someone-else', permissions: { canPublish: true } }
    );
    expect(state.canPublish).toBe(false);
  });

  it('resets to true on disconnect', async () => {
    holders.permissions = { canPublish: false };
    await connectToRoom('t', 'ws://x');
    await disconnectFromRoom();
    expect(getLiveKitState().canPublish).toBe(true);
  });
});
