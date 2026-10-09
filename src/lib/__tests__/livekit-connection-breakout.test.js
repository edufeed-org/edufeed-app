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

  it('tells the registered listener about every participant that joins after us', () => {
    const seen = [];
    const stop = svc.onParticipantJoined((p) => seen.push(p.identity));
    const bob = remote('b'.repeat(64) + ':x1');
    room.emit(RoomEvent.ParticipantConnected, bob);
    expect(seen).toEqual([bob.identity]);
    stop();
    room.emit(RoomEvent.ParticipantConnected, remote('c'.repeat(64) + ':x2'));
    expect(seen).toHaveLength(1);
  });

  it('keeps a local system line (a call broadcast) in the chat without ever sending or replaying it', async () => {
    const host = 'a'.repeat(64) + ':h';
    const line = svc.addSystemCallChat({ identity: host, text: 'two minutes left', id: 'bc-1' });
    expect(line).toMatchObject({
      id: 'bc-1',
      identity: host,
      text: 'two minutes left',
      system: 'broadcast'
    });
    expect(svc.getLiveKitState().callChat).toEqual([line]);
    // the same broadcast twice (the relay echo after the local copy) is kept once
    expect(
      svc.addSystemCallChat({ identity: host, text: 'two minutes left', id: 'bc-1' })
    ).toBeNull();
    expect(svc.getLiveKitState().callChat).toHaveLength(1);
    expect(room.localParticipant.publishData).not.toHaveBeenCalled();
    // my own line (the host's client keeps its copy too) is not chat history for a newcomer
    svc.addSystemCallChat({ identity: room.localParticipant.identity, text: 'mine', id: 'bc-2' });
    room.emit(RoomEvent.ParticipantConnected, remote('b'.repeat(64) + ':x1'));
    await Promise.resolve();
    expect(room.localParticipant.publishData).not.toHaveBeenCalled();
  });

  it('reports the current media state for a room switch that keeps mic and camera', async () => {
    expect(svc.currentJoinMedia()).toEqual({ audio: false, video: false });
    await svc.toggleMute();
    expect(svc.currentJoinMedia()).toEqual({ audio: true, video: false });
  });

  it('keeps the media state of a seat the server ended, for the way back to the main room', async () => {
    await svc.toggleMute();
    expect(svc.currentJoinMedia()).toEqual({ audio: true, video: false });
    // the relay deleted the breakout room: LiveKit ends the seat (ROOM_DELETED)
    room.emit(RoomEvent.Disconnected, 5);
    expect(svc.getLiveKitState().isConnected).toBe(false);
    expect(svc.currentJoinMedia()).toEqual({ audio: true, video: false });
    // leaving for real forgets it
    await svc.disconnectFromRoom();
    expect(svc.currentJoinMedia()).toEqual({ audio: false, video: false });
  });
});

describe('call chat across room switches', () => {
  const texts = () => svc.getLiveKitState().callChat.map((c) => c.text);
  /** Connect to the room named `chatKey` (a channel or a breakout room). */
  async function enter(chatKey) {
    await svc.connectToRoom('t', 'wss://lk', { chatKey });
    room = rooms[rooms.length - 1];
  }

  it("keeps each room's chat across a breakout switch and forgets all of it when the call is left", async () => {
    await svc.disconnectFromRoom();
    await enter('main');
    await svc.sendCallChat('hello main');
    expect(texts()).toEqual(['hello main']);

    // into a breakout room: the main room's chat is set aside, the room starts empty
    await svc.disconnectFromRoom({ keepChat: true });
    await enter('r1');
    expect(texts()).toEqual([]);
    await svc.sendCallChat('hello room');

    // back to the main room: its chat is there again
    await svc.disconnectFromRoom({ keepChat: true });
    await enter('main');
    expect(texts()).toEqual(['hello main']);

    // and back into the same room: its chat too
    await svc.disconnectFromRoom({ keepChat: true });
    await enter('r1');
    expect(texts()).toEqual(['hello room']);

    // leaving the call for good forgets every room
    await svc.disconnectFromRoom();
    await enter('r1');
    expect(texts()).toEqual([]);
    await svc.disconnectFromRoom({ keepChat: true });
    await enter('main');
    expect(texts()).toEqual([]);
  });

  it('a room the server ended keeps its chat until the switch sets it aside', async () => {
    await svc.disconnectFromRoom();
    await enter('r1');
    await svc.sendCallChat('hello room');
    // the relay deleted the room: the seat is ended, the chat still shown
    room.emit(RoomEvent.Disconnected, 5);
    expect(texts()).toEqual(['hello room']);
    // the way back: the room's chat is set aside like after any switch
    await svc.disconnectFromRoom({ keepChat: true });
    await enter('main');
    expect(texts()).toEqual([]);
    await svc.disconnectFromRoom({ keepChat: true });
    await enter('r1');
    expect(texts()).toEqual(['hello room']);
  });
});
