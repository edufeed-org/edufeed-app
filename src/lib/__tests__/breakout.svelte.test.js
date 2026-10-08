// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * breakout.svelte.js — the breakout session store: the host creates and
 * seats rooms and announces them; an assigned seat is asked and switches
 * without the lobby; a client in a room follows the relay (removed →
 * main, added elsewhere → there, room deleted → main, deadline → main);
 * the host moves people and brings everyone back. Ephemeral-groups
 * extension: late joiners get the session replayed (and a seat when the
 * host asked for that) or find it on the relay; a co-host handed the host
 * seat takes the session over; a room the relay deleted sends its seat
 * home; the deadline can be moved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { Subject } from 'rxjs';

const RELAY = 'wss://groups.example/';
const KEY = 'ab'.repeat(32);
const HOST = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);
const DAVE = 'd'.repeat(64);
const MAIN = { id: 'main-id', relay: RELAY };
/** A deadline that is not yet due under real timers. */
const FUTURE = Math.floor(Date.now() / 1000) + 3600;

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
vi.mock(
  '$lib/services/livekit-connection.svelte.js',
  () => import('./__mocks__/livekit-connection-fake.svelte.js')
);
const prefs = vi.hoisted(() => ({ autoAssign: /** @type {boolean | null} */ (null) }));
vi.mock('$lib/services/call-prefs.js', () => ({
  getBreakoutAutoAssign: () => prefs.autoAssign,
  setBreakoutAutoAssign: (/** @type {boolean} */ v) => {
    prefs.autoAssign = v;
  }
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
  groups_call_breakout_end_partial: (/** @type {any} */ p) => `not deleted: ${p.rooms}`,
  groups_call_breakout_took_over: () => 'you run the session now',
  groups_call_breakout_join_no_host: () => 'nobody can seat you',
  groups_call_breakout_room_closed: () => 'room closed, back in main',
  groups_call_breakout_extend_failed: (/** @type {any} */ p) => `not extended: ${p.reason}`
}));

const rel = vi.hoisted(() => ({
  createBreakoutRoom: vi.fn(async () => ({ kind: 39000 })),
  seatInRoom: vi.fn(async () => {}),
  unseatFromRoom: vi.fn(async () => {}),
  deleteBreakoutRoom: vi.fn(async () => {}),
  fetchEphemeralChildren: vi.fn(async () => []),
  editBreakoutUntil: vi.fn(async () => {})
}));
vi.mock('$lib/groups/breakout-relay.js', () => ({
  createBreakoutRoom: (/** @type {any[]} */ ...a) => rel.createBreakoutRoom(...a),
  seatInRoom: (/** @type {any[]} */ ...a) => rel.seatInRoom(...a),
  unseatFromRoom: (/** @type {any[]} */ ...a) => rel.unseatFromRoom(...a),
  deleteBreakoutRoom: (/** @type {any[]} */ ...a) => rel.deleteBreakoutRoom(...a),
  fetchEphemeralChildren: (/** @type {any[]} */ ...a) => rel.fetchEphemeralChildren(...a),
  editBreakoutUntil: (/** @type {any[]} */ ...a) => rel.editBreakoutUntil(...a)
}));

const callFake = await import('./__mocks__/group-call-fake.svelte.js');
const lkFake = await import('./__mocks__/livekit-connection-fake.svelte.js');
const store = await import('$lib/groups/breakout.svelte.js');
const { BREAKOUT_MOVE_GRACE_MS, BREAKOUT_JOIN_REQUEST_TIMEOUT_MS } = store;
// the fake's listeners are live bindings; read them through the module
const lk = {
  get listener() {
    return lkFake.breakoutListener;
  },
  get joined() {
    return lkFake.joinedListener;
  },
  send: lkFake.sendBreakoutMessage
};

const hostUser = { pubkey: HOST, signer: { signEvent: vi.fn() } };
const bobUser = { pubkey: BOB, signer: { signEvent: vi.fn() } };
const hostSender = { identity: HOST + ':h', metadata: JSON.stringify({ host: true }) };
const HOST_META = JSON.stringify({ host: true });
/** A relay-signed kind 39000 of a breakout room. */
const roomMeta = (id, index, until = null, at = 10) => ({
  kind: 39000,
  pubkey: KEY,
  created_at: at,
  tags: [
    ['d', id],
    ['name', `Breakout ${index} · Seminar`],
    ['ephemeral', 'main-id'],
    ...(until !== null ? [['until', String(until)]] : []),
    ['hidden'],
    ['livekit']
  ]
});

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
  for (let i = 0; i < 10; i++) {
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
  lkFake.resetLiveKitFake();
  prefs.autoAssign = null;
  flushSync();
  relay.subs.length = 0;
  rel.fetchEphemeralChildren.mockResolvedValue([]);
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

    lkFake.setIdentity('d'.repeat(64) + ':x');
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

describe('late joiners: the host seat replays the session and seats them', () => {
  /** The host runs a session from the main room and holds the host seat. */
  async function hostingWithSeat({ autoAssign = true } = {}) {
    lkFake.setIdentity(HOST + ':h');
    lkFake.setMyMetadata(HOST_META);
    await liveInMain(hostUser);
    await store.startBreakout({
      channelName: 'Seminar',
      roomCount: 2,
      seats: [
        { identity: BOB + ':seat1', pubkey: BOB, roomIndex: 1 },
        { identity: CAROL + ':seat1', pubkey: CAROL, roomIndex: 1 }
      ],
      durationMinutes: 10,
      autoAssign
    });
    await settle();
    const roomIds = rel.createBreakoutRoom.mock.calls.map((c) => c[1].id);
    const sub = liveSub();
    sub.stream.next(roster(roomIds[0], [HOST, BOB, CAROL]));
    sub.stream.next(roster(roomIds[1], [HOST]));
    sub.stream.next('EOSE');
    await settle();
    rel.seatInRoom.mockClear();
    lk.send.mockClear();
    return { roomIds, sub };
  }

  it('hands a newcomer the state and seats them in the smallest room with a targeted assignment', async () => {
    const { roomIds } = await hostingWithSeat();
    expect(lk.joined).toBeTypeOf('function');
    lk.joined?.({ identity: DAVE + ':s', metadata: '' });
    await settle();
    await settle();
    expect(rel.seatInRoom).toHaveBeenCalledWith(expect.anything(), roomIds[1], DAVE, hostUser);
    const [[state, stateTo], [assign, assignTo]] = lk.send.mock.calls;
    expect(stateTo).toEqual([DAVE + ':s']);
    expect(state).toEqual({
      t: 'state',
      rooms: [
        { id: roomIds[0], relay: RELAY, name: 'Breakout 1 · Seminar' },
        { id: roomIds[1], relay: RELAY, name: 'Breakout 2 · Seminar' }
      ],
      until: expect.any(Number)
    });
    expect(assignTo).toEqual([DAVE + ':s']);
    expect(assign.rooms).toEqual([
      { id: roomIds[1], relay: RELAY, name: 'Breakout 2 · Seminar', members: [DAVE + ':s'] }
    ]);
  });

  it('with auto-assign off only replays the state; guests and my own second seat get no seat either way', async () => {
    await hostingWithSeat({ autoAssign: false });
    lk.joined?.({ identity: DAVE + ':s', metadata: '' });
    await settle();
    expect(rel.seatInRoom).not.toHaveBeenCalled();
    expect(lk.send).toHaveBeenCalledTimes(1);
    expect(lk.send.mock.calls[0][0].t).toBe('state');

    store.setSessionAutoAssign(true);
    expect(prefs.autoAssign).toBe(true);
    lk.send.mockClear();
    lk.joined?.({ identity: 'e'.repeat(64) + ':g', metadata: '{"guest":true,"pass":"x"}' });
    lk.joined?.({ identity: HOST + ':second', metadata: '' });
    await settle();
    await settle();
    expect(rel.seatInRoom).not.toHaveBeenCalled();
    expect(lk.send.mock.calls.map((c) => c[0].t)).toEqual(['state', 'state']);
  });

  it('sends a seat that is already in a roster (a rejoin) back to its room without seating it again', async () => {
    const { roomIds } = await hostingWithSeat();
    lk.joined?.({ identity: BOB + ':seat2', metadata: '' });
    await settle();
    await settle();
    expect(rel.seatInRoom).not.toHaveBeenCalled();
    expect(lk.send.mock.calls[1][0].rooms[0].id).toBe(roomIds[0]);
  });

  it('does nothing for newcomers while this client does not hold the host seat', async () => {
    await liveInMain(hostUser);
    await store.startBreakout({ channelName: 'Seminar', roomCount: 2, seats: [] });
    await settle();
    lk.send.mockClear();
    lk.joined?.({ identity: DAVE + ':s', metadata: '' });
    await settle();
    expect(lk.send).not.toHaveBeenCalled();
    expect(rel.seatInRoom).not.toHaveBeenCalled();
  });

  it('a newcomer handed the state sees the rooms (the banner) without being asked to switch', async () => {
    await liveInMain(bobUser);
    lk.listener?.(
      { t: 'state', rooms: ROOMS.map(({ id, relay, name }) => ({ id, relay, name })), until: 99 },
      hostSender
    );
    const s = store.getBreakoutState();
    expect(s.session?.hosting).toBe(false);
    expect(s.rooms.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(s.session?.until).toBe(99);
    expect(modal.activeModal).toBe('none');
    // a plain participant's state is not believed
    store.__resetBreakout();
    lk.listener?.({ t: 'state', rooms: [] }, { identity: CAROL + ':x', metadata: '' });
    expect(store.getBreakoutState().session).toBeNull();
  });
});

describe('late joiners: "Beitreten" from the banner', () => {
  async function bobSeesSession() {
    await liveInMain(bobUser);
    lk.listener?.(
      { t: 'state', rooms: ROOMS.map(({ id, relay, name }) => ({ id, relay, name })) },
      hostSender
    );
    await settle();
    lk.send.mockClear();
    callFake.switchGroupCall.mockClear();
  }

  it('seats itself when the relay allows it, and switches', async () => {
    await bobSeesSession();
    await store.requestBreakoutRoom(store.getBreakoutState().rooms[1]);
    await settle();
    expect(rel.seatInRoom).toHaveBeenCalledWith(expect.anything(), 'r2', BOB, bobUser);
    expect(callFake.switchGroupCall).toHaveBeenCalledWith(
      { id: 'r2', relay: RELAY },
      { title: 'Breakout 2 · Seminar' }
    );
    expect(lk.send).not.toHaveBeenCalled();
  });

  it('otherwise asks the host seat and switches on the answer, without the prompt', async () => {
    vi.useFakeTimers();
    await bobSeesSession();
    rel.seatInRoom.mockRejectedValueOnce(new Error('restricted: insufficient permissions'));
    const request = store.requestBreakoutRoom(store.getBreakoutState().rooms[1]);
    await vi.advanceTimersByTimeAsync(10);
    await request;
    expect(lk.send).toHaveBeenCalledWith({ t: 'join', room: 'r2' });
    expect(store.getBreakoutState().joinRequest).toEqual({ roomId: 'r2' });
    expect(callFake.switchGroupCall).not.toHaveBeenCalled();
    // the host seat answers with a targeted assignment
    lk.listener?.({ t: 'assign', rooms: [{ ...ROOMS[1], members: [BOB + ':seat1'] }] }, hostSender);
    await settle();
    expect(modal.activeModal).toBe('none');
    expect(store.getBreakoutState().joinRequest).toBeNull();
    expect(callFake.switchGroupCall).toHaveBeenCalledWith(
      { id: 'r2', relay: RELAY },
      { title: 'Breakout 2 · Seminar' }
    );
  });

  it('gives up on an unanswered request and says so', async () => {
    vi.useFakeTimers();
    await bobSeesSession();
    rel.seatInRoom.mockRejectedValueOnce(new Error('restricted'));
    const request = store.requestBreakoutRoom(store.getBreakoutState().rooms[0]);
    await vi.advanceTimersByTimeAsync(10);
    await request;
    await vi.advanceTimersByTimeAsync(BREAKOUT_JOIN_REQUEST_TIMEOUT_MS + 10);
    expect(store.getBreakoutState().joinRequest).toBeNull();
    expect(toast.fn).toHaveBeenCalledWith('nobody can seat you', 'error');
  });

  it('the host seat answers a join request: seat, then the targeted assignment', async () => {
    lkFake.setIdentity(HOST + ':h');
    lkFake.setMyMetadata(HOST_META);
    await liveInMain(hostUser);
    await store.startBreakout({ channelName: 'Seminar', roomCount: 2, seats: [] });
    await settle();
    const roomIds = rel.createBreakoutRoom.mock.calls.map((c) => c[1].id);
    lk.send.mockClear();
    lk.listener?.({ t: 'join', room: roomIds[1] }, { identity: DAVE + ':s', metadata: '' });
    await settle();
    await settle();
    expect(rel.seatInRoom).toHaveBeenCalledWith(expect.anything(), roomIds[1], DAVE, hostUser);
    const [payload, to] = lk.send.mock.calls[0];
    expect(to).toEqual([DAVE + ':s']);
    expect(payload.rooms[0]).toMatchObject({ id: roomIds[1], members: [DAVE + ':s'] });
    // a guest's request is ignored, and so is one for an unknown room
    rel.seatInRoom.mockClear();
    lk.listener?.(
      { t: 'join', room: roomIds[0] },
      { identity: DAVE + ':g', metadata: '{"guest":true}' }
    );
    lk.listener?.({ t: 'join', room: 'nope' }, { identity: DAVE + ':s', metadata: '' });
    await settle();
    expect(rel.seatInRoom).not.toHaveBeenCalled();
  });
});

describe('late joiners: the relay lists the running session (#ephemeral)', () => {
  it('finds the rooms on joining the call and shows them without hosting', async () => {
    rel.fetchEphemeralChildren.mockResolvedValue([
      roomMeta('r2', 2, FUTURE),
      roomMeta('r1', 1, FUTURE),
      { ...roomMeta('r9', 9), pubkey: 'f'.repeat(64) } // not the relay's key
    ]);
    await liveInMain(bobUser);
    await settle();
    expect(rel.fetchEphemeralChildren).toHaveBeenCalledWith(expect.anything(), 'main-id');
    const s = store.getBreakoutState();
    expect(s.session?.hosting).toBe(false);
    expect(s.rooms.map((r) => [r.id, r.index])).toEqual([
      ['r1', 1],
      ['r2', 2]
    ]);
    expect(s.session?.until).toBe(FUTURE);
    expect(modal.activeModal).toBe('none');
  });

  it('asks once per call and leaves a session the host already replayed alone', async () => {
    let resolveFetch;
    rel.fetchEphemeralChildren.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFetch = resolve))
    );
    await liveInMain(bobUser);
    lk.listener?.({ t: 'state', rooms: [{ ...ROOMS[0] }], until: FUTURE }, hostSender);
    resolveFetch([roomMeta('r1', 1), roomMeta('r2', 2)]);
    await settle();
    expect(store.getBreakoutState().rooms.map((r) => r.id)).toEqual(['r1']);
    // a second render of the same call does not ask again
    callFake.setCall({ pointer: MAIN, phase: 'ready' });
    await settle();
    expect(rel.fetchEphemeralChildren).toHaveBeenCalledTimes(1);
  });

  it('a relay without the extension answers nothing: no session', async () => {
    await liveInMain(bobUser);
    await settle();
    expect(store.getBreakoutState().session).toBeNull();
  });
});

describe('ephemeral groups: creation, leftovers, relay-side deletion', () => {
  it('deletes leftover ephemeral rooms of the channel before creating new ones', async () => {
    await liveInMain(hostUser);
    rel.fetchEphemeralChildren.mockResolvedValue([roomMeta('old-1', 1), roomMeta('old-2', 2)]);
    await store.startBreakout({ channelName: 'Seminar', roomCount: 2, seats: [] });
    expect(rel.deleteBreakoutRoom.mock.calls.map((c) => c[1])).toEqual(['old-1', 'old-2']);
    expect(rel.createBreakoutRoom).toHaveBeenCalledTimes(2);
    expect(rel.deleteBreakoutRoom.mock.invocationCallOrder[1]).toBeLessThan(
      rel.createBreakoutRoom.mock.invocationCallOrder[0]
    );
    // a refusal (old relay) is no reason to stop
    store.__resetBreakout();
    callFake.setCall({ pointer: MAIN, user: hostUser, phase: 'ready' });
    rel.deleteBreakoutRoom.mockRejectedValueOnce(new Error('restricted'));
    await store.startBreakout({ channelName: 'Seminar', roomCount: 2, seats: [] });
    expect(store.getBreakoutState().session?.hosting).toBe(true);
  });

  it('a relay-signed 9008 drops the room from the host panel', async () => {
    await liveInMain(hostUser);
    await store.startBreakout({ channelName: 'Seminar', roomCount: 3, seats: [] });
    await settle();
    const roomIds = rel.createBreakoutRoom.mock.calls.map((c) => c[1].id);
    liveSub().stream.next({ kind: 9008, pubkey: KEY, created_at: 12, tags: [['h', roomIds[1]]] });
    await settle();
    expect(store.getBreakoutState().rooms.map((r) => r.id)).toEqual([roomIds[0], roomIds[2]]);
    // ending afterwards deletes only what still stands
    await store.endBreakout();
    expect(rel.deleteBreakoutRoom.mock.calls.map((c) => c[1])).toEqual([roomIds[0], roomIds[2]]);
  });

  it('a seat in a room whose LiveKit room the relay deleted goes back to the main room', async () => {
    await liveInMain(bobUser);
    lk.listener?.({ t: 'assign', rooms: ROOMS }, hostSender);
    modal.callbacks.onConfirm();
    await settle();
    expect(store.getBreakoutState().currentRoom?.id).toBe('r1');
    callFake.switchGroupCall.mockClear();
    lkFake.setDisconnectReason(lkFake.ROOM_DELETED);
    callFake.setCall({ pointer: { id: 'r1', relay: RELAY }, phase: 'ended' });
    await settle();
    expect(callFake.switchGroupCall).toHaveBeenCalledWith(MAIN, { title: 'Seminar' });
    expect(store.getBreakoutState().currentRoom).toBeNull();
    expect(store.getBreakoutState().rooms.map((r) => r.id)).toEqual(['r2']);
    expect(toast.fn).toHaveBeenCalledWith('room closed, back in main', 'info');
  });

  it('a lost connection in a room is not a deletion: the ended view stays', async () => {
    await liveInMain(bobUser);
    lk.listener?.({ t: 'assign', rooms: ROOMS }, hostSender);
    modal.callbacks.onConfirm();
    await settle();
    callFake.switchGroupCall.mockClear();
    lkFake.setDisconnectReason(9); // SIGNAL_CLOSE
    callFake.setCall({ pointer: { id: 'r1', relay: RELAY }, phase: 'ended' });
    await settle();
    expect(callFake.switchGroupCall).not.toHaveBeenCalled();
    expect(store.getBreakoutState().currentRoom?.id).toBe('r1');
  });

  it('a non-hosting seat in the main room follows the rooms: closed rooms vanish, a moved deadline lands', async () => {
    await liveInMain(bobUser);
    lk.listener?.(
      {
        t: 'state',
        rooms: ROOMS.map(({ id, relay, name }) => ({ id, relay, name })),
        until: FUTURE
      },
      hostSender
    );
    await settle();
    const sub = liveSub();
    expect(sub).toBeTruthy();
    sub.stream.next(roomMeta('r1', 1, FUTURE + 900, 11));
    await settle();
    expect(store.getBreakoutState().session?.until).toBe(FUTURE + 900);
    sub.stream.next({ kind: 9008, pubkey: KEY, created_at: 12, tags: [['h', 'r1']] });
    sub.stream.next({ kind: 9008, pubkey: KEY, created_at: 12, tags: [['h', 'r2']] });
    await settle();
    expect(store.getBreakoutState().session).toBeNull();
  });
});

describe('host hand-over', () => {
  async function cohostWithSession() {
    lkFake.setIdentity(CAROL + ':c');
    lkFake.setMyMetadata(JSON.stringify({ cohost: true }));
    callFake.setCall({
      pointer: MAIN,
      user: { pubkey: CAROL, signer: {} },
      title: 'Seminar',
      phase: 'ready'
    });
    await store.ensureBreakoutListener();
    await settle();
    lk.listener?.({ t: 'assign', rooms: ROOMS, until: untilOf() }, hostSender);
    await settle();
    expect(store.getBreakoutState().session?.hosting).toBe(false);
    toast.fn.mockClear();
  }
  /** Ten minutes from the (possibly faked) clock. */
  const untilOf = () => Math.floor(Date.now() / 1000) + 600;

  it('a co-host handed the host seat takes the session over and may move and end', async () => {
    await cohostWithSession();
    prefs.autoAssign = false;
    lkFake.setMyMetadata(HOST_META);
    await settle();
    const s = store.getBreakoutState();
    expect(s.session?.hosting).toBe(true);
    expect(s.session?.creator).toBe(false);
    expect(s.session?.autoAssign).toBe(false);
    expect(s.session?.channelName).toBe('Seminar');
    expect(toast.fn).toHaveBeenCalledWith('you run the session now', 'info');
    // the former "only the creator" restriction is gone: moves and the end go to the relay
    await store.moveParticipant({ pubkey: BOB, toRoomId: 'r2' });
    expect(rel.seatInRoom).toHaveBeenCalledWith(expect.anything(), 'r2', BOB, expect.anything());
    await store.endBreakout();
    expect(rel.deleteBreakoutRoom.mock.calls.map((c) => c[1])).toEqual(['r1', 'r2']);
    expect(store.getBreakoutState().session).toBeNull();
  });

  it('does not take over while sitting in a breakout room, and a plain participant never does', async () => {
    await cohostWithSession();
    modal.callbacks?.onCancel?.();
    const room = store.getBreakoutState().rooms[0];
    await store.joinBreakoutRoom(room);
    await settle();
    lkFake.setMyMetadata(HOST_META);
    await settle();
    expect(store.getBreakoutState().session?.hosting).toBe(false);
    await store.returnToMain();
    await settle();
    // back in the main room with the seat: now it takes over
    expect(store.getBreakoutState().session?.hosting).toBe(true);
    // without the host seat (co-host only) nothing changes
    store.__resetBreakout();
    lkFake.setMyMetadata(JSON.stringify({ cohost: true }));
    lk.listener?.({ t: 'assign', rooms: ROOMS }, hostSender);
    await settle();
    expect(store.getBreakoutState().session?.hosting).toBe(false);
  });

  it('at the deadline the client that took over deletes the rooms while it holds the seat', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    await cohostWithSession();
    lkFake.setMyMetadata(HOST_META);
    await settle();
    await vi.advanceTimersByTimeAsync(601_000);
    await settle();
    expect(rel.deleteBreakoutRoom).toHaveBeenCalledTimes(2);
    expect(store.getBreakoutState().session).toBeNull();
  });
});

describe('moving the deadline', () => {
  it('"+5 Min" edits every room\'s until, keeps counting and tells the main room', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    await liveInMain(hostUser);
    await store.startBreakout({
      channelName: 'Seminar',
      roomCount: 2,
      seats: [],
      durationMinutes: 1
    });
    await settle();
    const roomIds = rel.createBreakoutRoom.mock.calls.map((c) => c[1].id);
    lk.send.mockClear();
    await store.extendBreakout(5);
    expect(rel.editBreakoutUntil).toHaveBeenCalledTimes(2);
    expect(rel.editBreakoutUntil.mock.calls[0].slice(1, 3)).toEqual([
      { id: roomIds[0], parentId: 'main-id', channelName: 'Seminar', index: 1 },
      1_700_000_000 + 60 + 300
    ]);
    expect(store.getBreakoutState().session?.until).toBe(1_700_000_000 + 360);
    expect(store.getBreakoutState().remaining).toBe(360);
    expect(lk.send).toHaveBeenCalledWith({
      t: 'state',
      rooms: roomIds.map((id, i) => ({ id, relay: RELAY, name: `Breakout ${i + 1} · Seminar` })),
      until: 1_700_000_000 + 360
    });
  });

  it('starts a deadline from now when there was none, and reports a refusal', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    await liveInMain(hostUser);
    await store.startBreakout({ channelName: 'Seminar', roomCount: 2, seats: [] });
    await settle();
    rel.editBreakoutUntil.mockRejectedValueOnce(new Error('restricted'));
    await store.extendBreakout(5);
    expect(toast.fn).toHaveBeenCalledWith('not extended: restricted', 'error');
    expect(store.getBreakoutState().session?.until).toBeNull();
    await store.extendBreakout(5);
    expect(store.getBreakoutState().session?.until).toBe(1_700_000_000 + 300);
  });
});
