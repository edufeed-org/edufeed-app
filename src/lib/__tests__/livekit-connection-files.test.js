// @ts-nocheck
/**
 * LiveKit Connection Service — files in the call chat (issue "share files
 * without storing them publicly"): LiveKit byte streams, so a file goes
 * through the SFU to the participants present right now and is stored on
 * no server; held as an object URL in memory only.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { rooms } = vi.hoisted(() => ({ rooms: [] }));
vi.mock('$lib/services/call-sounds.js', () => ({
  playJoinSound: vi.fn(),
  playLeaveSound: vi.fn(),
  playMuteSound: vi.fn(),
  playUnmuteSound: vi.fn(),
  playScreenShareSound: vi.fn()
}));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: vi.fn() }));

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
    Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' },
    Kind: { Audio: 'audio', Video: 'video' }
  };
  class MockRoom {
    handlers = {};
    byteHandlers = {};
    canPlaybackAudio = true;
    startAudio = vi.fn(async () => {});
    switchActiveDevice = vi.fn(async () => true);
    writers = [];
    localParticipant = {
      identity: 'e'.repeat(64) + ':me',
      permissions: undefined,
      setMicrophoneEnabled: vi.fn(async () => {}),
      setCameraEnabled: vi.fn(async () => {}),
      setScreenShareEnabled: vi.fn(async () => {}),
      publishData: vi.fn(async () => {}),
      streamBytes: vi.fn(async (opts) => {
        const writer = {
          opts,
          chunks: [],
          write: vi.fn(async (c) => writer.chunks.push(c)),
          close: vi.fn(async () => {})
        };
        rooms.at(-1).writers.push(writer);
        return writer;
      }),
      getTrackPublication: vi.fn(() => undefined),
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
    registerByteStreamHandler(topic, cb) {
      this.byteHandlers[topic] = cb;
    }
    unregisterByteStreamHandler(topic) {
      delete this.byteHandlers[topic];
    }
    async connect() {}
    async disconnect() {
      this.emit('disconnected', 1);
    }
    static getLocalDevices = vi.fn(async () => []);
  }
  const DisconnectReason = { CLIENT_INITIATED: 1 };
  return { Room: MockRoom, RoomEvent, Track, DisconnectReason };
});

const { RoomEvent } = await import('livekit-client');
const svc = await import('$lib/services/livekit-connection.svelte.js');
const unreadMod = await import('$lib/groups/call-chat-unread.svelte.js');

const BOB = 'b'.repeat(64) + ':x';
const flush = () => new Promise((r) => setTimeout(r, 0));
const bytes = (n) => new Uint8Array(Array.from({ length: n }, (_, i) => i % 251));
const fileOf = (name, size, type = 'text/plain') => new File([bytes(size)], name, { type });

let room;
let createdUrls;
beforeEach(async () => {
  createdUrls = [];
  URL.createObjectURL = vi.fn((blob) => {
    const u = `blob:${createdUrls.length}`;
    createdUrls.push({ u, blob });
    return u;
  });
  URL.revokeObjectURL = vi.fn();
  await svc.disconnectFromRoom();
  rooms.length = 0;
  await svc.connectToRoom('t', 'wss://lk');
  room = rooms[0];
  unreadMod.resetCallChatUnread();
});
afterEach(() => vi.useRealTimers());

const files = () => svc.getLiveKitState().callChat.filter((c) => c.file);

describe('sending a file', () => {
  it('streams the bytes on the file topic with name/size/mime and a message id, keeping a local copy', async () => {
    const file = fileOf('notizen.txt', 70_000);
    const result = await svc.sendCallFile(file);
    expect(result).toEqual({ ok: true });
    const [writer] = room.writers;
    expect(writer.opts).toMatchObject({
      topic: 'edufeed.call.file',
      name: 'notizen.txt',
      mimeType: 'text/plain',
      totalSize: 70_000
    });
    expect(writer.opts.attributes.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(writer.opts.destinationIdentities).toBeUndefined();
    const total = writer.chunks.reduce((n, c) => n + c.byteLength, 0);
    expect(total).toBe(70_000);
    expect(writer.close).toHaveBeenCalledTimes(1);
    const [msg] = files();
    expect(msg).toMatchObject({
      id: writer.opts.attributes.id,
      identity: room.localParticipant.identity,
      text: '',
      file: { name: 'notizen.txt', size: 70_000, mime: 'text/plain', status: 'done', progress: 1 }
    });
    expect(msg.file.url).toBe('blob:0');
  });

  it('sends privately with destinationIdentities and a `to` attribute', async () => {
    await svc.sendCallFile(fileOf('x.txt', 10), { to: BOB });
    const [writer] = room.writers;
    expect(writer.opts.destinationIdentities).toEqual([BOB]);
    expect(writer.opts.attributes.to).toBe(BOB);
    expect(files()[0].to).toBe(BOB);
  });

  it('refuses a file over 25 MB without touching the room', async () => {
    const big = { name: 'big.bin', size: 25 * 1024 * 1024 + 1, type: '', slice: () => ({}) };
    expect(await svc.sendCallFile(big)).toEqual({ ok: false, error: 'too-large' });
    expect(room.localParticipant.streamBytes).not.toHaveBeenCalled();
    expect(files()).toHaveLength(0);
  });

  it('marks the copy failed when the stream breaks', async () => {
    room.localParticipant.streamBytes.mockImplementationOnce(async () => {
      throw new Error('nope');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await svc.sendCallFile(fileOf('x.txt', 10))).toEqual({ ok: false, error: 'failed' });
    expect(files()[0].file.status).toBe('failed');
    warn.mockRestore();
  });
});

describe('receiving a file', () => {
  /** a ByteStreamReader stand-in */
  function reader(info, chunks) {
    const r = {
      info: { topic: 'edufeed.call.file', mimeType: 'image/png', attributes: {}, ...info },
      onProgress: undefined,
      readAll: vi.fn(async () => {
        r.onProgress?.(0.5);
        return chunks;
      })
    };
    return r;
  }
  const handler = () => room.byteHandlers['edufeed.call.file'];

  it('registers a byte stream handler and keeps a received file as an object URL', async () => {
    expect(typeof handler()).toBe('function');
    const id = '11111111-2222-4333-8444-555555555555';
    const r = reader({ id: 'S1', name: 'bild.png', size: 6, attributes: { id } }, [
      bytes(3),
      bytes(3)
    ]);
    const promise = handler()(r, { identity: BOB });
    expect(files()[0]).toMatchObject({
      id,
      identity: BOB,
      file: { status: 'receiving', name: 'bild.png', size: 6 }
    });
    await promise;
    const [msg] = files();
    expect(msg.file).toMatchObject({
      status: 'done',
      progress: 1,
      mime: 'image/png',
      url: 'blob:0'
    });
    expect(createdUrls[0].blob.size).toBe(6);
    expect(createdUrls[0].blob.type).toBe('image/png');
    expect(unreadMod.getCallChatUnread().count).toBe(1);
  });

  it('falls back to <identity>:<stream id> when the sender declares no id', async () => {
    await handler()(reader({ id: 'S2', name: 'a.txt', size: 1 }, [bytes(1)]), { identity: BOB });
    expect(files()[0].id).toBe(`${BOB}:S2`);
  });

  it('drops a file addressed to someone else, and one over 25 MB', async () => {
    await handler()(
      reader({ id: 'S3', name: 'x', size: 1, attributes: { to: 'c'.repeat(64) + ':y' } }, [
        bytes(1)
      ]),
      { identity: BOB }
    );
    await handler()(reader({ id: 'S4', name: 'huge', size: 25 * 1024 * 1024 + 1 }, []), {
      identity: BOB
    });
    expect(files()).toHaveLength(0);
  });

  it('keeps a file addressed to me, marked private', async () => {
    const me = room.localParticipant.identity;
    await handler()(reader({ id: 'S5', name: 'x', size: 1, attributes: { to: me } }, [bytes(1)]), {
      identity: BOB
    });
    expect(files()[0].to).toBe(me);
  });

  it('marks a broken download failed', async () => {
    const r = reader({ id: 'S6', name: 'x', size: 1 }, []);
    r.readAll = vi.fn(async () => {
      throw new Error('aborted');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await handler()(r, { identity: BOB });
    expect(files()[0].file.status).toBe('failed');
    warn.mockRestore();
  });
});

describe('files and the rest of the chat', () => {
  it('never replays files to a late joiner', async () => {
    await svc.sendCallChat('text');
    await svc.sendCallFile(fileOf('x.txt', 5));
    room.localParticipant.publishData.mockClear();
    room.emit(RoomEvent.ParticipantConnected, { identity: 'c'.repeat(64) + ':y' });
    await flush();
    const texts = room.localParticipant.publishData.mock.calls
      .filter(([, o]) => o.topic === 'edufeed.call.chat')
      .map(([b]) => JSON.parse(new TextDecoder().decode(b)).text);
    expect(texts).toEqual(['text']);
  });

  it('revokes the object URLs when the call ends', async () => {
    await svc.sendCallFile(fileOf('x.txt', 5));
    await svc.disconnectFromRoom();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:0');
    expect(svc.getLiveKitState().callChat).toEqual([]);
  });
});
