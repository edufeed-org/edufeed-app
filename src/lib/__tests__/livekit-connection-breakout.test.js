// @ts-nocheck
/**
 * LiveKit Connection Service — the breakout topic (`edufeed.call.breakout`):
 * a reliable data message beside the chat and signal topics, handed to ONE
 * registered listener (the breakout store) already decoded, with the sender.
 * The connection service never interprets the payload — breakout.js does.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { rooms } = vi.hoisted(() => ({ rooms: [] }));

const toast = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: (...a) => toast.fn(...a) }));
vi.mock('$lib/services/call-sounds.js', () => ({
  playJoinSound: vi.fn(),
  playLeaveSound: vi.fn(),
  playMuteSound: vi.fn(),
  playUnmuteSound: vi.fn(),
  playScreenShareSound: vi.fn()
}));

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
    Disconnected: 'disconnected',
    Reconnecting: 'reconnecting',
    SignalReconnecting: 'signalReconnecting',
    Reconnected: 'reconnected',
    DataReceived: 'dataReceived'
  };
  const Track = {
    Source: {
      Camera: 'camera',
      Microphone: 'microphone',
      ScreenShare: 'screen_share',
      ScreenShareAudio: 'screen_share_audio'
    },
    Kind: { Audio: 'audio', Video: 'video' }
  };
  class MockRoom {
    handlers = {};
    canPlaybackAudio = true;
    startAudio = vi.fn(async () => {});
    switchActiveDevice = vi.fn(async () => true);
    micTrack = { restartTrack: vi.fn(async () => {}) };
    micPublished = false;
    localParticipant = {
      identity: 'e'.repeat(64) + ':me',
      permissions: undefined,
      setMicrophoneEnabled: vi.fn(async (on) => {
        this.micPublished = on;
      }),
      setCameraEnabled: vi.fn(async () => {}),
      setScreenShareEnabled: vi.fn(async () => {}),
      publishData: vi.fn(async () => {}),
      getTrackPublication: vi.fn((source) =>
        source === 'microphone' && this.micPublished ? { track: this.micTrack } : undefined
      ),
      activeDeviceMap: new Map()
    };
    remoteParticipants = new Map();
    constructor(options) {
      this.options = options;
      rooms.push(this);
    }
    on(event, handler) {
      (this.handlers[event] ??= []).push(handler);
      return this;
    }
    emit(event, ...args) {
      for (const h of this.handlers[event] ?? []) h(...args);
    }
    async connect() {}
    // Like livekit-client: a local disconnect() emits Disconnected too.
    async disconnect() {
      this.emit('disconnected', 1);
    }
    static getLocalDevices = vi.fn(async () => []);
  }
  const DisconnectReason = {
    UNKNOWN_REASON: 0,
    CLIENT_INITIATED: 1,
    DUPLICATE_IDENTITY: 2,
    SERVER_SHUTDOWN: 3,
    PARTICIPANT_REMOVED: 4,
    ROOM_DELETED: 5,
    SIGNAL_CLOSE: 9
  };
  return { Room: MockRoom, RoomEvent, Track, DisconnectReason };
});

const { RoomEvent } = await import('livekit-client');
const svc = await import('$lib/services/livekit-connection.svelte.js');

const encode = (obj) => new TextEncoder().encode(JSON.stringify(obj));
const decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes));
const remote = (identity) => ({ identity, sid: 'PA_' + identity.slice(-3), setVolume: vi.fn() });

let room;
beforeEach(async () => {
  await svc.disconnectFromRoom();
  rooms.length = 0;
  await svc.connectToRoom('t', 'wss://lk');
  room = rooms[0];
});
afterEach(() => vi.useRealTimers());

describe('breakout data messages', () => {
  it('sends a reliable message on the breakout topic, to everyone or to named seats', async () => {
    await svc.sendBreakoutMessage({ t: 'end' });
    let [bytes, opts] = room.localParticipant.publishData.mock.calls.at(-1);
    expect(decode(bytes)).toEqual({ t: 'end' });
    expect(opts).toEqual({ reliable: true, topic: 'edufeed.call.breakout' });

    await svc.sendBreakoutMessage({ t: 'assign', rooms: [] }, ['a'.repeat(64) + ':1']);
    [bytes, opts] = room.localParticipant.publishData.mock.calls.at(-1);
    expect(decode(bytes)).toEqual({ t: 'assign', rooms: [] });
    expect(opts.destinationIdentities).toEqual(['a'.repeat(64) + ':1']);
  });

  it('hands a decoded breakout message with its sender to the registered listener', () => {
    const seen = [];
    const stop = svc.onBreakoutMessage((payload, sender) => seen.push([payload, sender.identity]));
    const bob = remote('b'.repeat(64) + ':x1');
    room.emit(
      RoomEvent.DataReceived,
      encode({ t: 'assign', rooms: [], until: 5 }),
      bob,
      undefined,
      'edufeed.call.breakout'
    );
    expect(seen).toEqual([[{ t: 'assign', rooms: [], until: 5 }, bob.identity]]);
    stop();
    room.emit(
      RoomEvent.DataReceived,
      encode({ t: 'end' }),
      bob,
      undefined,
      'edufeed.call.breakout'
    );
    expect(seen).toHaveLength(1);
  });

  it('keeps the breakout topic apart from chat and signals, and drops malformed bytes', () => {
    const seen = [];
    svc.onBreakoutMessage((payload) => seen.push(payload));
    const bob = remote('b'.repeat(64) + ':x1');
    room.emit(RoomEvent.DataReceived, encode({ t: 'end' }), bob, undefined, 'edufeed.call');
    room.emit(RoomEvent.DataReceived, encode({ t: 'end' }), bob, undefined, 'edufeed.call.chat');
    room.emit(
      RoomEvent.DataReceived,
      new Uint8Array([1, 2, 3]),
      bob,
      undefined,
      'edufeed.call.breakout'
    );
    expect(seen).toEqual([]);
    // ... and a breakout message never lands in the chat or raises a hand
    room.emit(
      RoomEvent.DataReceived,
      encode({ t: 'hand', v: true }),
      bob,
      undefined,
      'edufeed.call.breakout'
    );
    expect(svc.getLiveKitState().raisedHands.size).toBe(0);
    expect(svc.getLiveKitState().callChat).toEqual([]);
    expect(seen).toEqual([{ t: 'hand', v: true }]);
  });

  it('reports the current media state for a room switch that keeps mic and camera', async () => {
    expect(svc.currentJoinMedia()).toEqual({ audio: false, video: false });
    await svc.toggleMute();
    expect(svc.currentJoinMedia()).toEqual({ audio: true, video: false });
  });
});
