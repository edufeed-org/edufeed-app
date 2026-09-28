// @ts-nocheck
/**
 * LiveKit Connection Service — shared ownership of the one Room.
 *
 * Under /c/* the community layout renders its page 2-3× (responsive
 * variants, CSS hides the inactive ones), so a call stage can have twins.
 * Live regression 2026-09-28: each twin connected with the SAME token, the
 * server kicked the first as a duplicate identity and the visible stage
 * showed "could not establish pc connection". acquireRoom/releaseRoom make
 * the Room shared: one per token, torn down only when the last owner goes.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { constructed } = vi.hoisted(() => ({ constructed: { rooms: [] } }));

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
      identity: 'local-user'
    };
    remoteParticipants = new Map();
    disconnected = false;
    constructor() {
      constructed.rooms.push(this);
    }
    on() {
      return this;
    }
    connect() {
      return new Promise((resolve) => setTimeout(resolve, 5));
    }
    async disconnect() {
      this.disconnected = true;
    }
    static getLocalDevices = vi.fn(async () => []);
  }
  return { Room: MockRoom, RoomEvent, Track };
});

const { acquireRoom, releaseRoom, disconnectFromRoom, getLiveKitState } = await import(
  '$lib/services/livekit-connection.svelte.js'
);

describe('acquireRoom / releaseRoom', () => {
  beforeEach(async () => {
    await disconnectFromRoom();
    constructed.rooms.length = 0;
  });

  it('twins acquiring the same token share ONE Room, even while the first connect is in flight', async () => {
    const first = acquireRoom('tok-1', 'wss://lk');
    const second = acquireRoom('tok-1', 'wss://lk');
    await Promise.all([first, second]);
    expect(constructed.rooms).toHaveLength(1);
    expect(getLiveKitState().isConnected).toBe(true);
  });

  it('releasing one of two owners keeps the call; releasing the last disconnects', async () => {
    await Promise.all([acquireRoom('tok-1', 'wss://lk'), acquireRoom('tok-1', 'wss://lk')]);
    const [room] = constructed.rooms;

    await releaseRoom('tok-1');
    expect(room.disconnected).toBe(false);
    expect(getLiveKitState().isConnected).toBe(true);

    await releaseRoom('tok-1');
    expect(room.disconnected).toBe(true);
    expect(getLiveKitState().isConnected).toBe(false);
  });

  it('a stale release for an older token never touches the current call', async () => {
    await acquireRoom('tok-old', 'wss://lk');
    await acquireRoom('tok-new', 'wss://lk');
    const current = constructed.rooms[1];

    await releaseRoom('tok-old');
    expect(current.disconnected).toBe(false);
    expect(getLiveKitState().isConnected).toBe(true);
  });

  it('a new token replaces the previous call (one Room at a time)', async () => {
    await acquireRoom('tok-a', 'wss://lk');
    await acquireRoom('tok-b', 'wss://lk');
    expect(constructed.rooms).toHaveLength(2);
    expect(constructed.rooms[0].disconnected).toBe(true);
    expect(constructed.rooms[1].disconnected).toBe(false);
  });

  it('an explicit disconnect resets ownership so the next acquire connects fresh', async () => {
    await Promise.all([acquireRoom('tok-1', 'wss://lk'), acquireRoom('tok-1', 'wss://lk')]);
    await disconnectFromRoom();
    await releaseRoom('tok-1'); // late cleanup of a twin after "Leave call"
    await acquireRoom('tok-1', 'wss://lk');
    expect(constructed.rooms).toHaveLength(2);
    expect(getLiveKitState().isConnected).toBe(true);
  });
});
