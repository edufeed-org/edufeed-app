// @ts-nocheck
/**
 * LiveKit Connection Service — call features beyond join/leave:
 * live audio processing, central remote-audio playback with per-person
 * volume, reconnect + remote-mute state, screen share quality, and the
 * raise-hand / reaction signals (LiveKit data messages, topic
 * "edufeed.call" — NIP-29 has no client presence plane to carry them).
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

const { RoomEvent, DisconnectReason } = await import('livekit-client');
const svc = await import('$lib/services/livekit-connection.svelte.js');
const prefs = await import('$lib/services/call-prefs.js');

const ALICE = 'a'.repeat(64);

function remote(identity, { micOn = true } = {}) {
  return {
    identity,
    sid: 'PA_' + identity.slice(-3),
    isMicrophoneEnabled: micOn,
    setVolume: vi.fn()
  };
}

function audioTrack(sid) {
  const el = document.createElement('audio');
  return {
    kind: 'audio',
    sid,
    el,
    attach: vi.fn(() => el),
    detach: vi.fn(() => [el])
  };
}

const decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes));
const encode = (obj) => new TextEncoder().encode(JSON.stringify(obj));

let room;
beforeEach(async () => {
  await svc.disconnectFromRoom();
  rooms.length = 0;
  localStorage.clear();
  await svc.connectToRoom('t', 'wss://lk');
  room = rooms[0];
});
afterEach(() => vi.useRealTimers());

describe('audio processing, applied live', () => {
  it('stores the flags and restarts the published mic with the new constraints', async () => {
    await svc.toggleMute(); // publish the mic
    await svc.setAudioProcessingLive({ noiseSuppression: false });
    expect(prefs.getAudioProcessing().noiseSuppression).toBe(false);
    expect(room.micTrack.restartTrack).toHaveBeenCalledWith(
      expect.objectContaining({ noiseSuppression: false, channelCount: 1 })
    );
  });

  it('only stores them while the mic is not published', async () => {
    await svc.setAudioProcessingLive({ echoCancellation: false });
    expect(prefs.getAudioProcessing().echoCancellation).toBe(false);
    expect(room.micTrack.restartTrack).not.toHaveBeenCalled();
  });

  it('offers speaker selection only where Web Audio can pick an output', () => {
    // Remote audio runs through Web Audio (webAudioMix), so the output is
    // chosen on the AudioContext, not on a media element.
    class FakeAudioContext {}
    vi.stubGlobal('AudioContext', FakeAudioContext);
    try {
      expect(svc.canSelectSpeaker()).toBe(false);
      FakeAudioContext.prototype.setSinkId = () => {};
      expect(svc.canSelectSpeaker()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('remote audio playback + per-person volume', () => {
  it('plays each remote audio track through ONE hidden element and applies the stored volume', () => {
    prefs.setParticipantVolume(ALICE, 1.6);
    const alice = remote(ALICE + ':x1');
    const track = audioTrack('TR_1');
    room.emit(RoomEvent.TrackSubscribed, track, { source: 'microphone' }, alice);

    expect(track.attach).toHaveBeenCalledTimes(1);
    expect(document.body.contains(track.el)).toBe(true);
    expect(track.el.hidden).toBe(true);
    expect(alice.setVolume).toHaveBeenCalledWith(1.6, 'microphone');

    room.emit(RoomEvent.TrackUnsubscribed, track, { source: 'microphone' }, alice);
    expect(track.detach).toHaveBeenCalled();
    expect(document.body.contains(track.el)).toBe(false);
  });

  it('removes every playback element on disconnect', async () => {
    const track = audioTrack('TR_2');
    room.emit(RoomEvent.TrackSubscribed, track, { source: 'microphone' }, remote(ALICE + ':x1'));
    await svc.disconnectFromRoom();
    expect(document.body.contains(track.el)).toBe(false);
  });

  it('setParticipantVolume stores and applies to every seat of that person', () => {
    const seat1 = remote(ALICE + ':x1');
    const seat2 = remote(ALICE + ':x2');
    room.remoteParticipants.set(seat1.identity, seat1);
    room.remoteParticipants.set(seat2.identity, seat2);
    room.emit(RoomEvent.ParticipantConnected, seat1);

    svc.setParticipantVolume(ALICE, 0.4);
    expect(prefs.getParticipantVolume(ALICE)).toBe(0.4);
    expect(seat1.setVolume).toHaveBeenCalledWith(0.4, 'microphone');
    expect(seat2.setVolume).toHaveBeenCalledWith(0.4, 'microphone');
    // ... and their shared screen's sound follows the same slider.
    expect(seat1.setVolume).toHaveBeenCalledWith(0.4, 'screen_share_audio');
    expect(seat2.setVolume).toHaveBeenCalledWith(0.4, 'screen_share_audio');
  });
});

describe('connection + remote mute state', () => {
  it('reports reconnecting until the room is back', () => {
    expect(svc.getLiveKitState().connectionState).toBe('connected');
    room.emit(RoomEvent.Reconnecting);
    expect(svc.getLiveKitState().connectionState).toBe('reconnecting');
    room.emit(RoomEvent.Reconnected);
    expect(svc.getLiveKitState().connectionState).toBe('connected');
  });

  it('tracks which remote participants have their mic off', () => {
    const bob = remote('b'.repeat(64) + ':x1', { micOn: false });
    room.remoteParticipants.set(bob.identity, bob);
    room.emit(RoomEvent.TrackMuted, {}, bob);
    expect(svc.getLiveKitState().mutedIdentities.has(bob.identity)).toBe(true);
    bob.isMicrophoneEnabled = true;
    room.emit(RoomEvent.TrackUnmuted, {}, bob);
    expect(svc.getLiveKitState().mutedIdentities.has(bob.identity)).toBe(false);
  });
});

describe('screen share quality', () => {
  it('captures with the remembered preset and no system audio', async () => {
    prefs.setScreenShareQuality('720p15');
    await svc.toggleScreenShare();
    expect(room.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        audio: false,
        resolution: { width: 1280, height: 720, frameRate: 15 },
        contentHint: 'detail'
      })
    );
  });
});

describe('raise hand + reactions (data messages)', () => {
  it('raising a hand publishes it and marks the local seat', async () => {
    await svc.setHandRaised(true);
    const [bytes, opts] = room.localParticipant.publishData.mock.calls[0];
    expect(decode(bytes)).toEqual({ t: 'hand', v: true, at: expect.any(Number) });
    expect(opts).toEqual(expect.objectContaining({ reliable: true, topic: 'edufeed.call' }));
    expect(svc.getLiveKitState().raisedHands.has(room.localParticipant.identity)).toBe(true);
    await svc.setHandRaised(false);
    expect(svc.getLiveKitState().raisedHands.has(room.localParticipant.identity)).toBe(false);
  });

  it('shows a remote hand until lowered or the participant leaves', () => {
    const bob = remote('b'.repeat(64) + ':x1');
    room.emit(
      RoomEvent.DataReceived,
      encode({ t: 'hand', v: true }),
      bob,
      undefined,
      'edufeed.call'
    );
    expect(svc.getLiveKitState().raisedHands.has(bob.identity)).toBe(true);
    room.emit(RoomEvent.ParticipantDisconnected, bob);
    expect(svc.getLiveKitState().raisedHands.has(bob.identity)).toBe(false);
  });

  it('ignores messages on other topics and malformed payloads', () => {
    const bob = remote('b'.repeat(64) + ':x1');
    room.emit(RoomEvent.DataReceived, encode({ t: 'hand', v: true }), bob, undefined, 'other');
    room.emit(RoomEvent.DataReceived, new Uint8Array([1, 2, 3]), bob, undefined, 'edufeed.call');
    expect(svc.getLiveKitState().raisedHands.size).toBe(0);
  });

  it('re-sends a raised hand to someone who joins later', async () => {
    await svc.setHandRaised(true);
    room.localParticipant.publishData.mockClear();
    const carol = remote('c'.repeat(64) + ':x1');
    room.emit(RoomEvent.ParticipantConnected, carol);
    const [bytes, opts] = room.localParticipant.publishData.mock.calls[0];
    expect(decode(bytes)).toEqual({ t: 'hand', v: true, at: expect.any(Number) });
    expect(opts.destinationIdentities).toEqual([carol.identity]);
  });

  describe('hand queue: first raised first', () => {
    const T = 4_000_000_000_000; // after the real clock our beforeEach join used
    const hand = (who, v, extra = {}) =>
      room.emit(
        RoomEvent.DataReceived,
        encode({ t: 'hand', v, ...extra }),
        who,
        undefined,
        'edufeed.call'
      );

    it('orders raised hands by when they arrived; a lowered hand leaves the queue', () => {
      vi.useFakeTimers();
      const bob = remote('b'.repeat(64) + ':x');
      const carol = remote('c'.repeat(64) + ':x');
      vi.setSystemTime(new Date(T + 10_000));
      hand(carol, true);
      vi.setSystemTime(new Date(T + 11_000));
      hand(bob, true);
      expect([...svc.getLiveKitState().raisedHands]).toEqual([carol.identity, bob.identity]);
      hand(carol, false);
      vi.setSystemTime(new Date(T + 12_000));
      hand(carol, true);
      expect([...svc.getLiveKitState().raisedHands]).toEqual([bob.identity, carol.identity]);
    });

    it('a live hand cannot jump the queue with a backdated raise time', () => {
      vi.useFakeTimers();
      const bob = remote('b'.repeat(64) + ':x');
      const carol = remote('c'.repeat(64) + ':x');
      vi.setSystemTime(new Date(T + 20_000));
      hand(bob, true);
      vi.setSystemTime(new Date(T + 21_000));
      hand(carol, true, { at: T });
      expect([...svc.getLiveKitState().raisedHands]).toEqual([bob.identity, carol.identity]);
    });

    it('right after our join, a re-sent hand keeps its original raise time', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(T));
      await svc.disconnectFromRoom();
      await svc.connectToRoom('t', 'wss://lk');
      room = rooms.at(-1);
      const bob = remote('b'.repeat(64) + ':x');
      const carol = remote('c'.repeat(64) + ':x');
      vi.setSystemTime(new Date(T + 500));
      hand(carol, true, { at: T - 30_000 });
      hand(bob, true, { at: T - 60_000 });
      expect([...svc.getLiveKitState().raisedHands]).toEqual([bob.identity, carol.identity]);
    });

    it('my own raise sends its time and joins the queue behind earlier hands', async () => {
      vi.useFakeTimers();
      const bob = remote('b'.repeat(64) + ':x');
      vi.setSystemTime(new Date(T + 30_000));
      hand(bob, true);
      vi.setSystemTime(new Date(T + 31_000));
      await svc.setHandRaised(true);
      const sent = room.localParticipant.publishData.mock.calls
        .map(([b]) => decode(b))
        .find((p) => p.t === 'hand');
      expect(sent).toEqual({ t: 'hand', v: true, at: T + 31_000 });
      expect([...svc.getLiveKitState().raisedHands]).toEqual([
        bob.identity,
        room.localParticipant.identity
      ]);
    });
  });

  it('sends an allowed reaction, shows it locally and prunes it after a few seconds', async () => {
    vi.useFakeTimers();
    await svc.sendReaction('👍');
    expect(decode(room.localParticipant.publishData.mock.calls[0][0])).toEqual(
      expect.objectContaining({ t: 'react', e: '👍' })
    );
    expect(svc.getLiveKitState().reactions.map((r) => r.emoji)).toEqual(['👍']);
    vi.advanceTimersByTime(4500);
    expect(svc.getLiveKitState().reactions).toEqual([]);
  });

  it('refuses anything that is not an emoji (sent or received)', async () => {
    await svc.sendReaction('💣 boom');
    expect(room.localParticipant.publishData).not.toHaveBeenCalled();
    const bob = remote('b'.repeat(64) + ':x1');
    room.emit(
      RoomEvent.DataReceived,
      encode({ t: 'react', e: 'boom', n: 'x' }),
      bob,
      undefined,
      'edufeed.call'
    );
    expect(svc.getLiveKitState().reactions).toEqual([]);
  });

  // Task 19: any emoji from the full picker, and NIP-30 custom ones.
  it('sends and shows any unicode emoji, not only the quick ones', async () => {
    await svc.sendReaction('🫶');
    expect(decode(room.localParticipant.publishData.mock.calls[0][0])).toEqual(
      expect.objectContaining({ t: 'react', e: '🫶' })
    );
    expect(svc.getLiveKitState().reactions.map((r) => r.emoji)).toEqual(['🫶']);
  });

  it('sends a custom emoji with its shortcode and https image', async () => {
    await svc.sendReaction({ shortcode: 'parrot', url: 'https://x.org/p.gif' });
    expect(decode(room.localParticipant.publishData.mock.calls[0][0])).toEqual({
      t: 'react',
      e: ':parrot:',
      n: expect.any(String),
      custom: { shortcode: 'parrot', url: 'https://x.org/p.gif' }
    });
    expect(svc.getLiveKitState().reactions).toEqual([
      expect.objectContaining({ emoji: ':parrot:', url: 'https://x.org/p.gif' })
    ]);
  });

  it('shows a received custom emoji; drops one with a non-https image', () => {
    const bob = remote('b'.repeat(64) + ':x1');
    const send = (custom, n) =>
      room.emit(
        RoomEvent.DataReceived,
        encode({ t: 'react', e: `:${custom.shortcode}:`, n, custom }),
        bob,
        undefined,
        'edufeed.call'
      );
    send({ shortcode: 'evil', url: 'http://x.org/e.gif' }, 'n1');
    send({ shortcode: 'parrot', url: 'https://x.org/p.gif' }, 'n2');
    expect(svc.getLiveKitState().reactions).toEqual([
      {
        id: `${bob.identity}:n2`,
        identity: bob.identity,
        emoji: ':parrot:',
        url: 'https://x.org/p.gif'
      }
    ]);
  });

  it('cannot signal on a listen-only token without data rights', async () => {
    await svc.disconnectFromRoom();
    rooms.length = 0;
    const promise = svc.connectToRoom('t', 'wss://lk');
    rooms[0].localParticipant.permissions = { canPublish: false, canPublishData: false };
    await promise;
    expect(svc.getLiveKitState().canSignal).toBe(false);
    await svc.setHandRaised(true);
    expect(rooms[0].localParticipant.publishData).not.toHaveBeenCalled();
  });
});

describe('in-call chat (data messages)', () => {
  it('sends a call chat message on the chat topic and keeps it locally', async () => {
    await svc.sendCallChat('  hallo  ');
    const [bytes, opts] = room.localParticipant.publishData.mock.calls.at(-1);
    expect(opts).toMatchObject({ reliable: true, topic: 'edufeed.call.chat' });
    expect(decode(bytes)).toMatchObject({ t: 'chat', text: 'hallo' });
    expect(svc.getLiveKitState().callChat.at(-1)).toMatchObject({ text: 'hallo' });
  });

  it('receives chat, drops garbage and oversized text, dedupes by nonce', () => {
    const bob = remote('b'.repeat(64) + ':x');
    const emit = (payload) =>
      room.emit(
        RoomEvent.DataReceived,
        new TextEncoder().encode(payload),
        bob,
        undefined,
        'edufeed.call.chat'
      );
    emit(JSON.stringify({ t: 'chat', text: 'hi', n: 'n1' }));
    emit(JSON.stringify({ t: 'chat', text: 'hi', n: 'n1' }));
    emit('not json');
    emit(JSON.stringify({ t: 'chat', text: 'x'.repeat(2001), n: 'n2' }));
    emit(JSON.stringify({ t: 'chat', text: 42, n: 'n3' }));
    expect(svc.getLiveKitState().callChat.map((c) => c.text)).toEqual(['hi']);
  });

  // The unread dots: others' messages count (once, deduped), mine never do,
  // and leaving the call clears the marker.
  it('reports only new messages from others to the unread marker', async () => {
    const { getCallChatUnread } = await import('$lib/groups/call-chat-unread.svelte.js');
    const unread = getCallChatUnread();
    const before = unread.count;
    await svc.sendCallChat('meins');
    expect(unread.count).toBe(before);
    const bob = remote('b'.repeat(64) + ':x');
    const emit = (/** @type {any} */ obj) =>
      room.emit(
        RoomEvent.DataReceived,
        new TextEncoder().encode(JSON.stringify(obj)),
        bob,
        undefined,
        'edufeed.call.chat'
      );
    emit({ t: 'chat', text: 'hi', n: 'u1' });
    emit({ t: 'chat', text: 'hi', n: 'u1' });
    emit({ t: 'chat', text: 42, n: 'u2' });
    expect(unread.count).toBe(before + 1);
    await svc.disconnectFromRoom();
    expect(unread.count).toBe(0);
  });

  // Late joiners: the chat is ephemeral, so each present participant hands a
  // newcomer its OWN recent messages (never anyone else's — the sender
  // identity must stay LiveKit-verified), with their original send time.
  it('sends a newcomer only my own recent messages, oldest first, with their send time', async () => {
    const me = room.localParticipant.identity;
    const bob = remote('b'.repeat(64) + ':x');
    await svc.sendCallChat('erste');
    room.emit(
      RoomEvent.DataReceived,
      encode({ t: 'chat', text: 'von bob', n: 'b1' }),
      bob,
      undefined,
      'edufeed.call.chat'
    );
    await svc.sendCallChat('zweite');
    const mine = svc.getLiveKitState().callChat.filter((c) => c.identity === me);
    room.localParticipant.publishData.mockClear();

    const carol = remote('c'.repeat(64) + ':y');
    room.emit(RoomEvent.ParticipantConnected, carol);
    await new Promise((r) => setTimeout(r, 0));

    const replays = room.localParticipant.publishData.mock.calls.filter(
      ([, opts]) => opts.topic === 'edufeed.call.chat'
    );
    expect(replays).toHaveLength(2);
    for (const [, opts] of replays) {
      expect(opts).toMatchObject({ reliable: true, destinationIdentities: [carol.identity] });
    }
    const payloads = replays.map(([bytes]) => decode(bytes));
    expect(payloads.map((p) => p.text)).toEqual(['erste', 'zweite']);
    expect(payloads.map((p) => p.ts)).toEqual(mine.map((c) => c.at));
    expect(payloads.map((p) => p.id)).toEqual(mine.map((c) => c.id));
  });

  it('replays at most my last 50 messages', async () => {
    for (let i = 0; i < 55; i++) await svc.sendCallChat(`m${i}`);
    room.localParticipant.publishData.mockClear();
    room.emit(RoomEvent.ParticipantConnected, remote('c'.repeat(64) + ':y'));
    await new Promise((r) => setTimeout(r, 0));
    const texts = room.localParticipant.publishData.mock.calls
      .filter(([, opts]) => opts.topic === 'edufeed.call.chat')
      .map(([bytes]) => decode(bytes).text);
    expect(texts).toHaveLength(50);
    expect(texts[0]).toBe('m5');
    expect(texts.at(-1)).toBe('m54');
  });

  it('orders received messages by their send time and ignores a replayed duplicate', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(10_000_000));
    const bob = remote('b'.repeat(64) + ':x');
    const emit = (obj) =>
      room.emit(RoomEvent.DataReceived, encode(obj), bob, undefined, 'edufeed.call.chat');
    emit({ t: 'chat', text: 'live', n: 'n2' });
    // bob's replay of history after we (re)joined: older, so it goes first
    emit({ t: 'chat', text: 'earlier', n: 'n1', ts: 9_000_000 });
    // the same message again (live copy + replay): shown once
    emit({ t: 'chat', text: 'live', n: 'n2', ts: 10_000_000 });
    const chat = svc.getLiveKitState().callChat;
    expect(chat.map((c) => c.text)).toEqual(['earlier', 'live']);
    expect(chat[0].at).toBe(9_000_000);
  });

  it('clamps a replayed send time older than a call pass can live (12 h) to that floor', () => {
    vi.useFakeTimers();
    const now = 100_000_000_000;
    vi.setSystemTime(new Date(now));
    const bob = remote('b'.repeat(64) + ':x');
    room.emit(
      RoomEvent.DataReceived,
      encode({ t: 'chat', text: 'uralt', n: 'o1', ts: 1 }),
      bob,
      undefined,
      'edufeed.call.chat'
    );
    expect(svc.getLiveKitState().callChat.at(-1).at).toBe(now - 12 * 3600 * 1000);
  });

  it('clamps a send time in the future to now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(10_000_000));
    const bob = remote('b'.repeat(64) + ':x');
    room.emit(
      RoomEvent.DataReceived,
      encode({ t: 'chat', text: 'from the future', n: 'f1', ts: 99_000_000 }),
      bob,
      undefined,
      'edufeed.call.chat'
    );
    expect(svc.getLiveKitState().callChat.at(-1).at).toBe(10_000_000);
  });

  // Final review 2 minor: `ts` is only for history REPLAYS, which arrive
  // right after a join. A live message with a backdated `ts` must not slide
  // up the chat (by up to 12 h) — late, it gets its receive time.
  describe('send time is honoured only as a replay', () => {
    const T = 50_000_000_000;
    const bob = remote('b'.repeat(64) + ':x');
    const emit = (obj) =>
      room.emit(RoomEvent.DataReceived, encode(obj), bob, undefined, 'edufeed.call.chat');
    const at = (n) => svc.getLiveKitState().callChat.find((c) => c.n === n)?.at;

    it("within 5 s of the sender's arrival: the replayed send time stands", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(T));
      room.emit(RoomEvent.ParticipantConnected, bob);
      vi.setSystemTime(new Date(T + 2_000));
      emit({ t: 'chat', text: 'history', n: 'h1', ts: T - 60_000 });
      expect(at('h1')).toBe(T - 60_000);
    });

    it("later than 5 s after the sender's arrival: receive time, not the claimed ts", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(T));
      room.emit(RoomEvent.ParticipantConnected, bob);
      vi.setSystemTime(new Date(T + 10_000));
      emit({ t: 'chat', text: 'backdated', n: 'l1', ts: T - 3600_000 });
      expect(at('l1')).toBe(T + 10_000);
    });

    it('a sender already there when we joined: replay right after our join, not later', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(T));
      await svc.disconnectFromRoom();
      await svc.connectToRoom('t', 'wss://lk');
      room = rooms.at(-1);
      vi.setSystemTime(new Date(T + 1_000));
      emit({ t: 'chat', text: 'history', n: 'h2', ts: T - 60_000 });
      expect(at('h2')).toBe(T - 60_000);
      vi.setSystemTime(new Date(T + 6_000));
      emit({ t: 'chat', text: 'backdated', n: 'l2', ts: T - 60_000 });
      expect(at('l2')).toBe(T + 6_000);
    });
  });

  it('records at receipt whether the sender joined through a call link', () => {
    const guest = { ...remote('b'.repeat(64) + ':g'), metadata: '{"guest":true}' };
    const member = remote('c'.repeat(64) + ':m');
    for (const [who, n] of [
      [guest, 'g1'],
      [member, 'm1']
    ]) {
      room.emit(
        RoomEvent.DataReceived,
        encode({ t: 'chat', text: 'hi', n }),
        who,
        undefined,
        'edufeed.call.chat'
      );
    }
    const chat = svc.getLiveKitState().callChat;
    expect(chat.find((c) => c.n === 'g1').guest).toBe(true);
    expect(chat.find((c) => c.n === 'm1').guest).toBeUndefined();
  });

  it('clears the call chat on disconnect', async () => {
    await svc.sendCallChat('bye');
    await svc.disconnectFromRoom();
    expect(svc.getLiveKitState().callChat).toEqual([]);
  });
});

// The server can end a seat on its own: a revoked call pass makes the relay
// remove the guest, a moderator kicks someone, the room is deleted, or the
// connection just dies. The call store must hear about it (live 2026-10-01:
// the stage said "Connecting…" forever) — but not about our own leave.
describe('unexpected disconnects', () => {
  it('records the reason and tells the listener when the server ends the seat', () => {
    const seen = [];
    const off = svc.onRoomDisconnected((reason) => seen.push(reason));
    room.emit(RoomEvent.Disconnected, DisconnectReason.PARTICIPANT_REMOVED);
    expect(seen).toEqual([DisconnectReason.PARTICIPANT_REMOVED]);
    const state = svc.getLiveKitState();
    expect(state.disconnectReason).toBe(DisconnectReason.PARTICIPANT_REMOVED);
    expect(state.isConnected).toBe(false);
    off();
  });

  it('tears the dead Room down but keeps the call chat readable; nothing more is sent', async () => {
    await svc.sendCallChat('vorher');
    const track = audioTrack('TR_dead');
    room.emit(RoomEvent.TrackSubscribed, track, { source: 'microphone' }, remote(ALICE + ':x'));
    room.localParticipant.publishData.mockClear();
    room.emit(RoomEvent.Disconnected, DisconnectReason.PARTICIPANT_REMOVED);
    const state = svc.getLiveKitState();
    expect(state.room).toBeNull();
    expect(state.isConnected).toBe(false);
    expect(state.canSignal).toBe(false);
    expect(track.detach).toHaveBeenCalled();
    expect(state.callChat.map((c) => c.text)).toEqual(['vorher']);
    await svc.sendCallChat('danach');
    expect(room.localParticipant.publishData).not.toHaveBeenCalled();
    expect(svc.getLiveKitState().callChat.map((c) => c.text)).toEqual(['vorher']);
  });

  it('does not call the listener for our own disconnectFromRoom', async () => {
    const listener = vi.fn();
    const off = svc.onRoomDisconnected(listener);
    await svc.disconnectFromRoom();
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it('stops calling a listener once unsubscribed', () => {
    const listener = vi.fn();
    svc.onRoomDisconnected(listener)();
    room.emit(RoomEvent.Disconnected, DisconnectReason.SIGNAL_CLOSE);
    expect(listener).not.toHaveBeenCalled();
  });

  it('classifies removal vs. a dropped connection', () => {
    expect(svc.isRemovalReason(DisconnectReason.PARTICIPANT_REMOVED)).toBe(true);
    expect(svc.isRemovalReason(DisconnectReason.ROOM_DELETED)).toBe(true);
    expect(svc.isRemovalReason(DisconnectReason.SIGNAL_CLOSE)).toBe(false);
    expect(svc.isRemovalReason(undefined)).toBe(false);
  });
});

// Issue "emoji picker and :shortcode: autocomplete" (foundation): every
// message carries a client-generated id (what replies will point at) and
// may carry NIP-30 custom emojis as [shortcode, url] pairs.
describe('call chat payload: ids and custom emojis', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const bob = remote('b'.repeat(64) + ':x');
  const emit = (obj, from = bob) =>
    room.emit(RoomEvent.DataReceived, encode(obj), from, undefined, 'edufeed.call.chat');

  it('sends a uuid id with a nonce derived from it, and keys the local copy by that id', async () => {
    await svc.sendCallChat('hallo');
    const [bytes] = room.localParticipant.publishData.mock.calls.at(-1);
    const payload = decode(bytes);
    expect(payload.id).toMatch(UUID_RE);
    expect(payload.n).toBe(payload.id.replace(/-/g, ''));
    expect(svc.getLiveKitState().callChat.at(-1).id).toBe(payload.id);
  });

  it('sends custom emojis as pairs and keeps them on the local copy', async () => {
    const emoji = [['party', 'https://cdn.example/party.png']];
    await svc.sendCallChat('los :party:', { emoji });
    const [bytes] = room.localParticipant.publishData.mock.calls.at(-1);
    expect(decode(bytes).emoji).toEqual(emoji);
    expect(svc.getLiveKitState().callChat.at(-1).emoji).toEqual(emoji);
  });

  it('keys a received message by its id, or by identity:nonce for a peer without ids', () => {
    emit({ t: 'chat', text: 'neu', n: 'n1', id: '11111111-2222-4333-8444-555555555555' });
    emit({ t: 'chat', text: 'alt', n: 'n2' });
    const chat = svc.getLiveKitState().callChat;
    expect(chat.find((c) => c.text === 'neu').id).toBe('11111111-2222-4333-8444-555555555555');
    expect(chat.find((c) => c.text === 'alt').id).toBe(`${bob.identity}:n2`);
  });

  it('dedupes on (identity, nonce) and on id alike', () => {
    const id = '11111111-2222-4333-8444-555555555555';
    emit({ t: 'chat', text: 'eins', n: 'n1', id });
    emit({ t: 'chat', text: 'eins', n: 'n1' }); // same nonce, id-less copy
    emit({ t: 'chat', text: 'eins', n: 'other', id }); // same id, other nonce
    expect(svc.getLiveKitState().callChat.filter((c) => c.text === 'eins')).toHaveLength(1);
  });

  it("re-keys a message whose id collides with another sender's (never two rows with one key)", () => {
    const id = '11111111-2222-4333-8444-555555555555';
    const carol = remote('c'.repeat(64) + ':y');
    emit({ t: 'chat', text: 'von bob', n: 'n1', id });
    emit({ t: 'chat', text: 'von carol', n: 'n9', id }, carol);
    const chat = svc.getLiveKitState().callChat;
    expect(chat.map((c) => c.text)).toEqual(['von bob', 'von carol']);
    expect(chat[1].id).toBe(`${carol.identity}:n9`);
    expect(new Set(chat.map((c) => c.id)).size).toBe(2);
  });

  it('keeps received custom emojis (validated) on the message', () => {
    emit({
      t: 'chat',
      text: ':party: :bad:',
      n: 'e1',
      emoji: [
        ['party', 'https://cdn.example/party.png'],
        ['bad', 'javascript:alert(1)']
      ]
    });
    expect(svc.getLiveKitState().callChat.at(-1).emoji).toEqual([
      ['party', 'https://cdn.example/party.png']
    ]);
  });

  it('replays my messages with their id and emoji intact', async () => {
    const emoji = [['party', 'https://cdn.example/party.png']];
    await svc.sendCallChat('los :party:', { emoji });
    const sent = decode(room.localParticipant.publishData.mock.calls.at(-1)[0]);
    room.localParticipant.publishData.mockClear();
    room.emit(RoomEvent.ParticipantConnected, remote('c'.repeat(64) + ':y'));
    await new Promise((r) => setTimeout(r, 0));
    const [replay] = room.localParticipant.publishData.mock.calls
      .filter(([, opts]) => opts.topic === 'edufeed.call.chat')
      .map(([bytes]) => decode(bytes));
    expect(replay).toMatchObject({ id: sent.id, n: sent.n, emoji, text: 'los :party:' });
    expect(typeof replay.ts).toBe('number');
  });
});

// Issue "Video-Call chat: reply-to": a reply points at the original's id and
// embeds a preview (author + first line) so the quote shows even where the
// original never arrived; both survive the late-joiner replay.
describe('call chat payload: replies', () => {
  const bob = remote('b'.repeat(64) + ':x');
  const chatSends = () =>
    room.localParticipant.publishData.mock.calls
      .filter(([, opts]) => opts.topic === 'edufeed.call.chat')
      .map(([bytes]) => decode(bytes));

  it('sends replyTo + replyPreview, keeps them locally and replays them', async () => {
    const replyTo = '11111111-2222-4333-8444-555555555555';
    const replyPreview = { n: 'Bob', text: 'erste Zeile' };
    await svc.sendCallChat('dazu: ja', { replyTo, replyPreview });
    expect(chatSends().at(-1)).toMatchObject({ replyTo, replyPreview });
    expect(svc.getLiveKitState().callChat.at(-1)).toMatchObject({ replyTo, replyPreview });
    room.localParticipant.publishData.mockClear();
    room.emit(RoomEvent.ParticipantConnected, remote('c'.repeat(64) + ':y'));
    await new Promise((r) => setTimeout(r, 0));
    expect(chatSends().at(-1)).toMatchObject({ replyTo, replyPreview, text: 'dazu: ja' });
  });

  it('drops a replyTo that is a legacy local key (no wire id) but keeps the preview', async () => {
    await svc.sendCallChat('dazu', {
      replyTo: `${bob.identity}:n1`,
      replyPreview: { n: 'Bob', text: 'alt' }
    });
    const sent = chatSends().at(-1);
    expect(sent.replyTo).toBeUndefined();
    expect(sent.replyPreview).toEqual({ n: 'Bob', text: 'alt' });
  });

  it('keeps a received reply reference (validated) on the message', () => {
    room.emit(
      RoomEvent.DataReceived,
      encode({
        t: 'chat',
        text: 'antwort',
        n: 'r1',
        replyTo: '11111111-2222-4333-8444-555555555555',
        replyPreview: { n: 'Al', text: 'zeile 1\nzeile 2' }
      }),
      bob,
      undefined,
      'edufeed.call.chat'
    );
    expect(svc.getLiveKitState().callChat.at(-1)).toMatchObject({
      replyTo: '11111111-2222-4333-8444-555555555555',
      replyPreview: { n: 'Al', text: 'zeile 1' }
    });
  });
});

// Issue "@mentions of call participants": `mentions` travels with the
// message; a message that names me (or everyone) is a stronger signal —
// counted separately and toasted while no chat view is on screen.
describe('call chat payload: mentions', () => {
  const bob = remote('b'.repeat(64) + ':x');
  bob.name = 'Bob';
  const emit = (obj) =>
    room.emit(RoomEvent.DataReceived, encode(obj), bob, undefined, 'edufeed.call.chat');

  it('sends mentions, keeps them locally and replays them', async () => {
    const mentions = ['c'.repeat(64) + ':y', '*'];
    await svc.sendCallChat('@Carol @alle los', { mentions });
    expect(decode(room.localParticipant.publishData.mock.calls.at(-1)[0]).mentions).toEqual(
      mentions
    );
    expect(svc.getLiveKitState().callChat.at(-1).mentions).toEqual(mentions);
    room.localParticipant.publishData.mockClear();
    room.emit(RoomEvent.ParticipantConnected, remote('d'.repeat(64) + ':z'));
    await new Promise((r) => setTimeout(r, 0));
    expect(decode(room.localParticipant.publishData.mock.calls.at(-1)[0]).mentions).toEqual(
      mentions
    );
  });

  it('notes a mention of me (or everyone) with a toast naming the sender, not one of someone else', async () => {
    const { getCallChatUnread, resetCallChatUnread } = await import(
      '$lib/groups/call-chat-unread.svelte.js'
    );
    resetCallChatUnread();
    toast.fn.mockClear();
    const me = room.localParticipant.identity;
    emit({ t: 'chat', text: 'an dich', n: 'm1', mentions: [me] });
    emit({ t: 'chat', text: 'an alle', n: 'm2', mentions: ['*'] });
    emit({ t: 'chat', text: 'an carol', n: 'm3', mentions: ['c'.repeat(64) + ':y'] });
    expect(getCallChatUnread().mentions).toBe(2);
    expect(toast.fn).toHaveBeenCalledTimes(2);
    expect(toast.fn.mock.calls[0][0]).toContain('Bob');
  });

  it('does not toast a mention that arrives while a chat view is on screen', async () => {
    const { registerCallChatView, getCallChatUnread, resetCallChatUnread } = await import(
      '$lib/groups/call-chat-unread.svelte.js'
    );
    resetCallChatUnread();
    toast.fn.mockClear();
    const off = registerCallChatView();
    emit({ t: 'chat', text: 'an alle', n: 'm4', mentions: ['*'] });
    expect(getCallChatUnread().mentions).toBe(0);
    expect(toast.fn).not.toHaveBeenCalled();
    off();
  });
});

// Issue "Video-Call: private 1:1 messages in the call chat": in-call only,
// ephemeral, delivered to one identity; never relayed to anyone else.
describe('call chat payload: private messages', () => {
  const bob = remote('b'.repeat(64) + ':x');
  const chatSends = () =>
    room.localParticipant.publishData.mock.calls.filter(
      ([, opts]) => opts.topic === 'edufeed.call.chat'
    );
  const emit = (obj) =>
    room.emit(RoomEvent.DataReceived, encode(obj), bob, undefined, 'edufeed.call.chat');

  it('sends a private message to one identity only and keeps the own copy marked', async () => {
    await svc.sendCallChat('nur fuer dich', { to: bob.identity });
    const [bytes, opts] = chatSends().at(-1);
    expect(opts.destinationIdentities).toEqual([bob.identity]);
    expect(decode(bytes).to).toBe(bob.identity);
    expect(svc.getLiveKitState().callChat.at(-1)).toMatchObject({
      text: 'nur fuer dich',
      to: bob.identity
    });
  });

  it('keeps a private message addressed to me and drops one addressed to someone else', () => {
    const me = room.localParticipant.identity;
    emit({ t: 'chat', text: 'psst', n: 'p1', to: me });
    emit({ t: 'chat', text: 'fuer carol', n: 'p2', to: 'c'.repeat(64) + ':y' });
    const texts = svc.getLiveKitState().callChat.map((c) => c.text);
    expect(texts).toContain('psst');
    expect(texts).not.toContain('fuer carol');
    expect(svc.getLiveKitState().callChat.find((c) => c.text === 'psst').to).toBe(me);
  });

  it('never replays private messages to a late joiner', async () => {
    await svc.sendCallChat('oeffentlich');
    await svc.sendCallChat('privat', { to: bob.identity });
    room.localParticipant.publishData.mockClear();
    room.emit(RoomEvent.ParticipantConnected, remote('c'.repeat(64) + ':y'));
    await new Promise((r) => setTimeout(r, 0));
    const texts = chatSends().map(([bytes]) => decode(bytes).text);
    expect(texts).toEqual(['oeffentlich']);
  });
});
