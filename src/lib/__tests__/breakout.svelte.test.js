// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * breakout.svelte.js — the breakout session store: the host creates and
 * seats rooms and announces them; an assigned seat is asked and switches
 * without the lobby; a client in a room follows the relay (removed →
 * main, added elsewhere → there, room deleted → main, deadline → main);
 * the host moves people and brings everyone back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { Subject } from 'rxjs';

const RELAY = 'wss://groups.example/';
const KEY = 'ab'.repeat(32);
const HOST = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);
const MAIN = { id: 'main-id', relay: RELAY };

/** @type {{ subs: Array<{filters: any[], stream: Subject<any>, closed: boolean}> }} */
const relay = vi.hoisted(() => ({ subs: [] }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {
    relay: () => ({
      subscription: (/** @type {any[]} */ filters) => {
        const stream = new Subject();
        const entry = { filters, stream, closed: false };
        relay.subs.push(entry);
        return {
          subscribe: (/** @type {any} */ handlers) => {
            const sub = stream.subscribe(handlers);
            return {
              unsubscribe: () => {
                entry.closed = true;
                sub.unsubscribe();
              }
            };
          }
        };
      }
    })
  }
}));
vi.mock('$lib/groups/relay-key-race.js', () => ({
  raceRelayKey: (/** @type {string} */ _relay, /** @type {any} */ { onAuthors, onReady }) => {
    onAuthors([KEY]);
    onReady();
    return () => {};
  }
}));
vi.mock('$lib/groups/group-call.svelte.js', () => import('./__mocks__/group-call-fake.svelte.js'));

const lk = vi.hoisted(() => ({
  listener: /** @type {((raw: unknown, sender: any) => void) | null} */ (null),
  identity: 'b'.repeat(64) + ':seat1',
  send: vi.fn(async () => {})
}));
vi.mock('$lib/services/livekit-connection.svelte.js', () => ({
  onBreakoutMessage: (/** @type {any} */ cb) => {
    lk.listener = cb;
    return () => {
      if (lk.listener === cb) lk.listener = null;
    };
  },
  sendBreakoutMessage: (/** @type {any[]} */ ...args) => lk.send(...args),
  getLiveKitState: () => ({ localParticipant: { identity: lk.identity } })
}));

const modal = vi.hoisted(() => ({
  activeModal: 'none',
  props: /** @type {any} */ (null),
  callbacks: /** @type {any} */ (null)
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: {
    get activeModal() {
      return modal.activeModal;
    },
    openModal: (/** @type {string} */ type, /** @type {any} */ props, /** @type {any} */ cbs) => {
      modal.activeModal = type;
      modal.props = props;
      modal.callbacks = cbs;
    },
    closeModal: () => {
      modal.activeModal = 'none';
      modal.props = null;
      modal.callbacks = null;
    }
  }
}));
const toast = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('$lib/helpers/toast', () => ({ showToast: (/** @type {any[]} */ ...a) => toast.fn(...a) }));
vi.mock('$lib/paraglide/messages', () => ({
  groups_call_breakout_switch_failed: () => 'switch failed',
  groups_call_breakout_end_partial: (/** @type {any} */ p) => `not deleted: ${p.rooms}`
}));

const rel = vi.hoisted(() => ({
  createBreakoutRoom: vi.fn(async () => ({ kind: 39000 })),
  seatInRoom: vi.fn(async () => {}),
  unseatFromRoom: vi.fn(async () => {}),
  deleteBreakoutRoom: vi.fn(async () => {})
}));
vi.mock('$lib/groups/breakout-relay.js', () => ({
  createBreakoutRoom: (/** @type {any[]} */ ...a) => rel.createBreakoutRoom(...a),
  seatInRoom: (/** @type {any[]} */ ...a) => rel.seatInRoom(...a),
  unseatFromRoom: (/** @type {any[]} */ ...a) => rel.unseatFromRoom(...a),
  deleteBreakoutRoom: (/** @type {any[]} */ ...a) => rel.deleteBreakoutRoom(...a)
}));

const callFake = await import('./__mocks__/group-call-fake.svelte.js');
const store = await import('$lib/groups/breakout.svelte.js');
const { BREAKOUT_MOVE_GRACE_MS } = store;

const hostUser = { pubkey: HOST, signer: { signEvent: vi.fn() } };
const bobUser = { pubkey: BOB, signer: { signEvent: vi.fn() } };
const hostSender = { identity: HOST + ':h', metadata: JSON.stringify({ host: true }) };

/** @param {string} id @param {string[]} members @param {number} [at] */
const roster = (id, members, at = 10) => ({
  kind: 39002,
  pubkey: KEY,
  created_at: at,
  tags: [['d', id], ...members.map((p) => ['p', p])]
});
const ROOMS = [
  { id: 'r1', relay: RELAY, name: 'Breakout 1 · Seminar', members: [BOB + ':seat1'] },
  { id: 'r2', relay: RELAY, name: 'Breakout 2 · Seminar', members: [CAROL + ':seat1'] }
];

/** Let awaited switches and effects settle. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    flushSync();
    await Promise.resolve();
  }
  flushSync();
}

/** The live roster subscription (the newest one still open). */
function liveSub() {
  const open = relay.subs.filter((s) => !s.closed);
  return open[open.length - 1];
}

beforeEach(async () => {
  vi.useRealTimers();
  store.__resetBreakout();
  callFake.setCall({ pointer: null, user: null, title: '', phase: 'idle' });
  flushSync();
  relay.subs.length = 0;
  lk.send.mockClear();
  lk.identity = BOB + ':seat1';
  modal.activeModal = 'none';
  modal.props = null;
  modal.callbacks = null;
  toast.fn.mockClear();
  callFake.switchGroupCall.mockClear();
  for (const fn of Object.values(rel)) fn.mockClear();
  rel.deleteBreakoutRoom.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

/** Join the main call as `user`; loads the connection listener. */
async function liveInMain(user) {
  callFake.setCall({ pointer: MAIN, user, title: 'Seminar', phase: 'ready' });
  await store.ensureBreakoutListener();
  await settle();
  expect(lk.listener).toBeTypeOf('function');
}

describe('host: startBreakout', () => {
  it('creates the rooms, seats the assigned pubkeys and announces the seats', async () => {
    await liveInMain(hostUser);
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    const seats = [
      { identity: BOB + ':seat1', pubkey: BOB, roomIndex: 1 },
      { identity: CAROL + ':seat1', pubkey: CAROL, roomIndex: 2 },
      { identity: CAROL + ':seat2', pubkey: CAROL, roomIndex: 2 }
    ];
    await store.startBreakout({ channelName: 'Seminar', roomCount: 2, seats, durationMinutes: 10 });

    expect(rel.createBreakoutRoom).toHaveBeenCalledTimes(2);
    const [, room1] = rel.createBreakoutRoom.mock.calls[0];
    expect(room1).toEqual({
      id: expect.any(String),
      parentId: 'main-id',
      channelName: 'Seminar',
      index: 1,
      until: 1_700_000_000 + 600
    });
    // one put-user per pubkey per room — Carol's two seats share one roster entry
    expect(rel.seatInRoom).toHaveBeenCalledTimes(2);
    const roomIds = rel.createBreakoutRoom.mock.calls.map((c) => c[1].id);
    expect(rel.seatInRoom.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [roomIds[0], BOB],
      [roomIds[1], CAROL]
    ]);
    const [payload, destinations] = lk.send.mock.calls[0];
    expect(destinations).toBeUndefined();
    expect(payload).toEqual({
      t: 'assign',
      until: 1_700_000_000 + 600,
      rooms: [
        { id: roomIds[0], relay: RELAY, name: 'Breakout 1 · Seminar', members: [BOB + ':seat1'] },
        {
          id: roomIds[1],
          relay: RELAY,
          name: 'Breakout 2 · Seminar',
          members: [CAROL + ':seat1', CAROL + ':seat2']
        }
      ]
    });
    const s = store.getBreakoutState();
    expect(s.session?.hosting).toBe(true);
    expect(s.session?.main).toEqual({ ...MAIN, title: 'Seminar' });
    expect(s.rooms.map((r) => r.index)).toEqual([1, 2]);
    expect(s.remaining).toBe(600);
  });

  it('tears half-built rooms down again when creation fails, and rethrows', async () => {
    await liveInMain(hostUser);
    rel.createBreakoutRoom
      .mockResolvedValueOnce({ kind: 39000 })
      .mockRejectedValueOnce(
        new Error('restricted: only members of this relay can create a group')
      );
    await expect(
      store.startBreakout({ channelName: 'Seminar', roomCount: 2, seats: [] })
    ).rejects.toThrow(/only members of this relay/);
    expect(rel.deleteBreakoutRoom).toHaveBeenCalledTimes(1);
    expect(store.getBreakoutState().session).toBeNull();
    expect(lk.send).not.toHaveBeenCalled();
  });
});

describe('participant: the assignment', () => {
  it('asks a seat that was assigned and switches it on confirm, without the lobby', async () => {
    await liveInMain(bobUser);
    lk.listener?.({ t: 'assign', rooms: ROOMS, until: null }, hostSender);
    expect(modal.activeModal).toBe('breakoutAssignment');
    expect(modal.props).toEqual({ roomName: 'Breakout 1 · Seminar', autoMs: 5000 });
    const s = store.getBreakoutState();
    expect(s.pending?.room.id).toBe('r1');
    expect(s.session?.hosting).toBe(false);

    modal.callbacks.onConfirm();
    await settle();
    expect(callFake.switchGroupCall).toHaveBeenCalledWith(
      { id: 'r1', relay: RELAY },
      { title: 'Breakout 1 · Seminar' }
    );
    expect(s.currentRoom?.id).toBe('r1');
    expect(modal.activeModal).toBe('none');
    // the switch passes through idle — the session survives it
    expect(s.session).not.toBeNull();
  });

  it('lets a seat stay, and ignores seats that were not assigned', async () => {
    await liveInMain(bobUser);
    lk.listener?.({ t: 'assign', rooms: ROOMS }, hostSender);
    modal.callbacks.onCancel();
    await settle();
    expect(callFake.switchGroupCall).not.toHaveBeenCalled();
    expect(store.getBreakoutState().currentRoom).toBeNull();
    expect(store.getBreakoutState().pending).toBeNull();

    lk.identity = 'd'.repeat(64) + ':x';
    lk.listener?.({ t: 'assign', rooms: ROOMS }, hostSender);
    expect(modal.activeModal).toBe('none');
  });

  it('believes assignments only from a seat the relay marked host or co-host', async () => {
    await liveInMain(bobUser);
    lk.listener?.({ t: 'assign', rooms: ROOMS }, { identity: CAROL + ':x', metadata: '' });
    lk.listener?.(
      { t: 'assign', rooms: ROOMS },
      { identity: CAROL + ':x', metadata: '{"guest":true}' }
    );
    expect(modal.activeModal).toBe('none');
    expect(store.getBreakoutState().session).toBeNull();
    lk.listener?.(
      { t: 'assign', rooms: ROOMS },
      { identity: CAROL + ':x', metadata: '{"cohost":true}' }
    );
    expect(modal.activeModal).toBe('breakoutAssignment');
  });

  it('forgets the session on the end signal and when the user leaves the call', async () => {
    await liveInMain(bobUser);
    lk.listener?.({ t: 'assign', rooms: ROOMS }, hostSender);
    lk.listener?.({ t: 'end' }, hostSender);
    expect(store.getBreakoutState().session).toBeNull();
    expect(modal.activeModal).toBe('none');

    lk.listener?.({ t: 'assign', rooms: ROOMS }, hostSender);
    expect(store.getBreakoutState().session).not.toBeNull();
    callFake.setCall({ pointer: null, phase: 'idle' });
    await settle();
    expect(store.getBreakoutState().session).toBeNull();
    expect(modal.activeModal).toBe('none');
  });
});

describe('participant in a room: following the relay', () => {
  /** Bob accepts room 1 and the roster subscription is open. */
  async function bobInRoom1(until = null) {
    await liveInMain(bobUser);
    lk.listener?.({ t: 'assign', rooms: ROOMS, until }, hostSender);
    modal.callbacks.onConfirm();
    await settle();
    expect(store.getBreakoutState().currentRoom?.id).toBe('r1');
    const sub = liveSub();
    expect(sub).toBeTruthy();
    expect(sub.filters[0]).toEqual({ kinds: [39000, 39002, 39004], '#d': ['r1', 'r2'] });
    expect(sub.filters[1]).toEqual({ kinds: [9008], '#h': ['r1', 'r2'] });
    callFake.switchGroupCall.mockClear();
    return sub;
  }

  it('stays while its own roster names it', async () => {
    const sub = await bobInRoom1();
    sub.stream.next(roster('r1', [HOST, BOB]));
    sub.stream.next(roster('r2', [HOST, CAROL]));
    sub.stream.next('EOSE');
    await settle();
    expect(callFake.switchGroupCall).not.toHaveBeenCalled();
    expect(store.getBreakoutState().membersByRoomId.r1.has(BOB)).toBe(true);
  });

  it('switches to the room whose roster now names it (a move)', async () => {
    const sub = await bobInRoom1();
    sub.stream.next(roster('r1', [HOST, BOB]));
    sub.stream.next(roster('r2', [HOST, CAROL]));
    sub.stream.next('EOSE');
    await settle();
    sub.stream.next(roster('r2', [HOST, CAROL, BOB], 11));
    sub.stream.next(roster('r1', [HOST], 11));
    await settle();
    expect(callFake.switchGroupCall).toHaveBeenCalledWith(
      { id: 'r2', relay: RELAY },
      { title: 'Breakout 2 · Seminar' }
    );
    expect(store.getBreakoutState().currentRoom?.id).toBe('r2');
  });

  it('returns to the main room when removed and not seated elsewhere — after the move grace', async () => {
    vi.useFakeTimers();
    const sub = await bobInRoom1();
    sub.stream.next(roster('r1', [HOST, BOB]));
    sub.stream.next('EOSE');
    await settle();
    sub.stream.next(roster('r1', [HOST], 11));
    await settle();
    expect(callFake.switchGroupCall).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(BREAKOUT_MOVE_GRACE_MS + 10);
    await settle();
    expect(callFake.switchGroupCall).toHaveBeenCalledWith(MAIN, { title: 'Seminar' });
    expect(store.getBreakoutState().currentRoom).toBeNull();
  });

  it('ignores a stale (older) roster and an untrusted signer', async () => {
    vi.useFakeTimers();
    const sub = await bobInRoom1();
    sub.stream.next(roster('r1', [HOST, BOB], 20));
    sub.stream.next('EOSE');
    sub.stream.next(roster('r1', [HOST], 5)); // older than what we have
    sub.stream.next({ ...roster('r1', [HOST], 30), pubkey: 'f'.repeat(64) }); // not the relay
    await settle();
    await vi.advanceTimersByTimeAsync(BREAKOUT_MOVE_GRACE_MS + 10);
    await settle();
    expect(callFake.switchGroupCall).not.toHaveBeenCalled();
  });

  it('returns to the main room when its room is deleted (kind 9008 or the tombstone)', async () => {
    const sub = await bobInRoom1();
    sub.stream.next({ kind: 9008, pubkey: HOST, created_at: 12, tags: [['h', 'r1']] });
    await settle();
    expect(callFake.switchGroupCall).toHaveBeenCalledWith(MAIN, { title: 'Seminar' });

    callFake.switchGroupCall.mockClear();
    store.__resetBreakout();
    const sub2 = await bobInRoom1();
    sub2.stream.next({
      kind: 39000,
      pubkey: KEY,
      created_at: 12,
      tags: [
        ['d', 'r1'],
        ['name', '[deleted]']
      ]
    });
    await settle();
    expect(callFake.switchGroupCall).toHaveBeenCalledWith(MAIN, { title: 'Seminar' });
    expect(store.getBreakoutState().rooms.map((r) => r.id)).toEqual(['r2']);
  });

  it('counts down to the deadline and returns at zero', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    await bobInRoom1(1_700_000_000 + 3);
    expect(store.getBreakoutState().remaining).toBe(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getBreakoutState().remaining).toBe(2);
    await vi.advanceTimersByTimeAsync(2100);
    await settle();
    expect(callFake.switchGroupCall).toHaveBeenCalledWith(MAIN, { title: 'Seminar' });
    expect(store.getBreakoutState().session).toBeNull();
  });

  it('"Zurück zum Hauptraum" is available to anyone in a room', async () => {
    await bobInRoom1();
    await store.returnToMain();
    await settle();
    expect(callFake.switchGroupCall).toHaveBeenCalledWith(MAIN, { title: 'Seminar' });
    expect(store.getBreakoutState().currentRoom).toBeNull();
  });
});

describe('host: moving people and ending', () => {
  async function hosting() {
    await liveInMain(hostUser);
    await store.startBreakout({
      channelName: 'Seminar',
      roomCount: 2,
      seats: [
        { identity: BOB + ':seat1', pubkey: BOB, roomIndex: 1 },
        { identity: CAROL + ':seat1', pubkey: CAROL, roomIndex: 2 }
      ]
    });
    await settle();
    const roomIds = rel.createBreakoutRoom.mock.calls.map((c) => c[1].id);
    const sub = liveSub();
    sub.stream.next(roster(roomIds[0], [HOST, BOB]));
    sub.stream.next(roster(roomIds[1], [HOST, CAROL]));
    sub.stream.next('EOSE');
    await settle();
    rel.seatInRoom.mockClear();
    lk.send.mockClear();
    return { roomIds, sub };
  }

  it('moves someone between rooms: seat in the new room first, then unseat', async () => {
    const { roomIds } = await hosting();
    await store.moveParticipant({
      pubkey: BOB,
      identities: [BOB + ':seat1'],
      toRoomId: roomIds[1]
    });
    expect(rel.seatInRoom).toHaveBeenCalledWith(expect.anything(), roomIds[1], BOB, hostUser);
    expect(rel.unseatFromRoom).toHaveBeenCalledWith(expect.anything(), roomIds[0], BOB, hostUser);
    expect(rel.seatInRoom.mock.invocationCallOrder[0]).toBeLessThan(
      rel.unseatFromRoom.mock.invocationCallOrder[0]
    );
    // the client is already in a room: it follows the rosters, no data message
    expect(lk.send).not.toHaveBeenCalled();
  });

  it('brings one person back to the main room by unseating only', async () => {
    const { roomIds } = await hosting();
    await store.moveParticipant({ pubkey: CAROL, toRoomId: null });
    expect(rel.seatInRoom).not.toHaveBeenCalled();
    expect(rel.unseatFromRoom).toHaveBeenCalledWith(expect.anything(), roomIds[1], CAROL, hostUser);
  });

  it('sends someone still in the main room into a room: seat plus a targeted assignment', async () => {
    const { roomIds } = await hosting();
    const DAVE = 'd'.repeat(64);
    await store.moveParticipant({ pubkey: DAVE, identities: [DAVE + ':s'], toRoomId: roomIds[0] });
    expect(rel.seatInRoom).toHaveBeenCalledWith(expect.anything(), roomIds[0], DAVE, hostUser);
    expect(rel.unseatFromRoom).not.toHaveBeenCalled();
    const [payload, destinations] = lk.send.mock.calls[0];
    expect(destinations).toEqual([DAVE + ':s']);
    expect(payload.rooms).toEqual([
      { id: roomIds[0], relay: RELAY, name: 'Breakout 1 · Seminar', members: [DAVE + ':s'] }
    ]);
  });

  it('"Alle zurückholen" deletes every room, tells the main room and forgets the session', async () => {
    const { roomIds, sub } = await hosting();
    await store.endBreakout();
    expect(rel.deleteBreakoutRoom.mock.calls.map((c) => c[1])).toEqual(roomIds);
    expect(lk.send).toHaveBeenCalledWith({ t: 'end' });
    expect(store.getBreakoutState().session).toBeNull();
    await settle();
    expect(sub.closed).toBe(true);
  });

  it('a host inside a room comes back to the main room when ending', async () => {
    const { roomIds } = await hosting();
    const room = store.getBreakoutState().rooms[0];
    await store.joinBreakoutRoom(room);
    await settle();
    expect(store.getBreakoutState().currentRoom?.id).toBe(roomIds[0]);
    callFake.switchGroupCall.mockClear();
    await store.endBreakout();
    await settle();
    expect(callFake.switchGroupCall).toHaveBeenCalledWith(MAIN, { title: 'Seminar' });
    expect(store.getBreakoutState().session).toBeNull();
  });

  it('reports rooms the relay refused to delete', async () => {
    await hosting();
    rel.deleteBreakoutRoom.mockRejectedValueOnce(new Error('restricted'));
    await store.endBreakout();
    expect(toast.fn).toHaveBeenCalledWith('not deleted: Breakout 1 · Seminar', 'error');
    expect(store.getBreakoutState().session).toBeNull();
  });

  it('at the deadline the host deletes the rooms', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    await liveInMain(hostUser);
    await store.startBreakout({ channelName: 'S', roomCount: 2, seats: [], durationMinutes: 1 });
    await settle();
    await vi.advanceTimersByTimeAsync(61_000);
    await settle();
    expect(rel.deleteBreakoutRoom).toHaveBeenCalledTimes(2);
    expect(store.getBreakoutState().session).toBeNull();
  });
});
