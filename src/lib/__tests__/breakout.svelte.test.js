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
 * home; the deadline can be moved. Guests (call-pass seats): assigned by
 * message only, switch with their code after announcing their room seat,
 * follow no roster, come back on a removal, are moved by the host through
 * the moderation endpoint plus a re-assignment in the main room.
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
  eventStore: { getReplaceable: () => undefined },
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
const relayPublish = vi.hoisted(() => ({
  fn: vi.fn(
    async (/** @type {any} */ _conn, /** @type {any} */ template, /** @type {any} */ user) => ({
      ...template,
      id: 'bc-' + Math.random().toString(36).slice(2, 8),
      pubkey: user.pubkey
    })
  )
}));
vi.mock('$lib/groups/group-management.js', async (importOriginal) => ({
  .../** @type {any} */ (await importOriginal()),
  publishToGroupRelay: (/** @type {any[]} */ ...a) => relayPublish.fn(...a)
}));
const lkApi = vi.hoisted(() => ({
  requestGroupCallToken: vi.fn(),
  moderateCall: vi.fn(async () => {})
}));
vi.mock('$lib/groups/livekit.js', async (importOriginal) => ({
  .../** @type {any} */ (await importOriginal()),
  requestGroupCallToken: (/** @type {any[]} */ ...a) => lkApi.requestGroupCallToken(...a),
  moderateCall: (/** @type {any[]} */ ...a) => lkApi.moderateCall(...a)
}));
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
  groups_call_breakout_switch_failed: (/** @type {any} */ p) => `switch failed: ${p.reason}`,
  groups_call_breakout_moved_out: () => 'taken out, back in main',
  groups_call_breakout_guest_move_failed: (/** @type {any} */ p) => `guest not moved: ${p.reason}`,
  groups_call_breakout_guest_move_timeout: () => 'guest did not come back',
  groups_call_error_generic: () => 'generic',
  groups_call_breakout_end_partial: (/** @type {any} */ p) => `not deleted: ${p.rooms}`,
  groups_call_breakout_took_over: () => 'you run the session now',
  groups_call_breakout_join_no_host: () => 'nobody can seat you',
  groups_call_breakout_room_closed: () => 'room closed, back in main',
  groups_call_breakout_extend_failed: (/** @type {any} */ p) => `not extended: ${p.reason}`,
  groups_call_breakout_deadline_failed: (/** @type {any} */ p) => `deadline not set: ${p.reason}`,
  groups_call_broadcast_toast: (/** @type {any} */ p) => `${p.name}: ${p.text}`,
  groups_call_broadcast_return_default: () => 'please come back',
  groups_call_breakout_broadcast_failed: (/** @type {any} */ p) => `not sent: ${p.reason}`,
  groups_call_breakout_arrived_main: (/** @type {any} */ p) => `${p.name} arrived in the main room`
}));

const rel = vi.hoisted(() => ({
  createBreakoutRoom: vi.fn(async () => ({ kind: 39000 })),
  seatInRoom: vi.fn(async () => {}),
  unseatFromRoom: vi.fn(async () => {}),
  deleteBreakoutRoom: vi.fn(async () => {}),
  fetchEphemeralChildren: vi.fn(async () => []),
  editBreakoutUntil: vi.fn(async () => {}),
  knockOnRoom: vi.fn(async () => {})
}));
vi.mock('$lib/groups/breakout-relay.js', () => ({
  knockOnRoom: (/** @type {any[]} */ ...a) => rel.knockOnRoom(...a),
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
/** A relay-signed kind 39004 of a room (or of the main room). @param {string} id @param {string[]} pubkeys @param {number} [at] */
const presence = (id, pubkeys, at = 10) => ({
  kind: 39004,
  pubkey: KEY,
  created_at: at,
  tags: [['d', id], ...pubkeys.map((p) => ['participant', p])]
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

/** The live roster subscription (the newest one still open; the broadcast one is kept apart). */
function liveSub() {
  const open = relay.subs.filter((s) => !s.closed && s.filters[0]?.['#d']);
  return open[open.length - 1];
}

beforeEach(async () => {
  vi.useRealTimers();
  store.__resetBreakout();
  callFake.setCall({ pointer: null, user: null, title: '', phase: 'idle', code: null });
  lkFake.resetLiveKitFake();
  prefs.autoAssign = null;
  flushSync();
  relay.subs.length = 0;
  rel.fetchEphemeralChildren.mockResolvedValue([]);
  relayPublish.fn.mockClear();
  lkFake.addSystemCallChat.mockClear();
  modal.activeModal = 'none';
  modal.props = null;
  modal.callbacks = null;
  toast.fn.mockClear();
  callFake.switchGroupCall.mockClear();
  for (const fn of Object.values(rel)) fn.mockClear();
  rel.deleteBreakoutRoom.mockResolvedValue(undefined);
  lkApi.requestGroupCallToken.mockReset();
  lkApi.moderateCall.mockReset();
  lkApi.moderateCall.mockResolvedValue(undefined);
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

  it('a member who came in through the invite link (code kept, member seat) still follows its roster', async () => {
    vi.useFakeTimers();
    // The relay ignores the code for a member: a member seat, no guest
    // metadata — the code the link carried must not make this seat a guest.
    lkFake.setMyMetadata('');
    callFake.setCall({
      pointer: MAIN,
      user: bobUser,
      title: 'Seminar',
      phase: 'ready',
      code: 'C'.repeat(22)
    });
    await store.ensureBreakoutListener();
    await settle();
    lk.listener?.({ t: 'assign', rooms: ROOMS, until: null }, hostSender);
    modal.callbacks.onConfirm();
    await settle();
    expect(store.getBreakoutState().currentRoom?.id).toBe('r1');
    // a member seat requests no room token of its own (that is the guest path)
    expect(lkApi.requestGroupCallToken).not.toHaveBeenCalled();
    const sub = liveSub();
    callFake.switchGroupCall.mockClear();
    sub.stream.next(roster('r1', [HOST, BOB]));
    sub.stream.next('EOSE');
    await settle();
    sub.stream.next(roster('r1', [HOST], 11));
    await settle();
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

  it('with auto-assign off only replays the state; a guest is assigned by message only and my own second seat not at all', async () => {
    const { roomIds } = await hostingWithSeat({ autoAssign: false });
    lk.joined?.({ identity: DAVE + ':s', metadata: '' });
    await settle();
    expect(rel.seatInRoom).not.toHaveBeenCalled();
    expect(lk.send).toHaveBeenCalledTimes(1);
    expect(lk.send.mock.calls[0][0].t).toBe('state');

    store.setSessionAutoAssign(true);
    expect(prefs.autoAssign).toBe(true);
    lk.send.mockClear();
    lk.joined?.({ identity: 'e'.repeat(64) + ':g', metadata: '{"guest":true,"pass":"x"}' });
    await settle();
    await settle();
    lk.joined?.({ identity: HOST + ':second', metadata: '' });
    await settle();
    await settle();
    // never a put-user for a guest — its pass opens the room; the smallest
    // room (room 2) is named in a targeted assignment instead
    expect(rel.seatInRoom).not.toHaveBeenCalled();
    expect(lk.send.mock.calls.map((c) => c[0].t)).toEqual(['state', 'assign', 'state']);
    const [assign, to] = lk.send.mock.calls[1];
    expect(to).toEqual(['e'.repeat(64) + ':g']);
    expect(assign.rooms).toEqual([
      {
        id: roomIds[1],
        relay: RELAY,
        name: 'Breakout 2 · Seminar',
        members: ['e'.repeat(64) + ':g']
      }
    ]);
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

// The host's client may sit in a breakout room, out of reach of the main
// room's data channel. Everything a late joiner and the host need then goes
// through the relay: a member knocks on a room (kind 9021, the relay seats
// them), a roster that names a main-room seat is the assignment, and the
// main room's 39004 tells the host who waits there.
describe('late joiners while the host sits in a room: relay-only paths', () => {
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

  it('"Beitreten" knocks on the room (kind 9021) and switches when the roster names the seat', async () => {
    vi.useFakeTimers();
    await bobSeesSession();
    rel.seatInRoom.mockRejectedValueOnce(new Error('restricted: insufficient permissions'));
    const request = store.requestBreakoutRoom(store.getBreakoutState().rooms[1]);
    await vi.advanceTimersByTimeAsync(10);
    await request;
    expect(rel.knockOnRoom).toHaveBeenCalledWith(expect.anything(), 'r2', bobUser);
    // the host seat is still asked too (an older relay, a host in the main room)
    expect(lk.send).toHaveBeenCalledWith({ t: 'join', room: 'r2' });
    expect(store.getBreakoutState().joinRequest).toEqual({ roomId: 'r2' });
    const sub = liveSub();
    sub.stream.next(roster('r2', [HOST, BOB], 20));
    sub.stream.next('EOSE');
    await settle();
    expect(store.getBreakoutState().joinRequest).toBeNull();
    expect(modal.activeModal).toBe('none');
    expect(callFake.switchGroupCall).toHaveBeenCalledWith(
      { id: 'r2', relay: RELAY },
      { title: 'Breakout 2 · Seminar' }
    );
  });

  it('a seat in the main room that a roster now names is asked to switch, once per room', async () => {
    await bobSeesSession();
    const sub = liveSub();
    sub.stream.next(roster('r1', [HOST, BOB], 20));
    sub.stream.next('EOSE');
    await settle();
    expect(modal.activeModal).toBe('breakoutAssignment');
    expect(store.getBreakoutState().pending?.room.id).toBe('r1');
    modal.callbacks.onCancel();
    await settle();
    expect(modal.activeModal).toBe('none');
    // the same room again (someone else was seated): not asked twice
    sub.stream.next(roster('r1', [HOST, BOB, CAROL], 21));
    await settle();
    expect(modal.activeModal).toBe('none');
    // moved to another room: asked again
    sub.stream.next(roster('r1', [HOST, CAROL], 22));
    sub.stream.next(roster('r2', [HOST, BOB], 22));
    await settle();
    expect(modal.activeModal).toBe('breakoutAssignment');
    expect(store.getBreakoutState().pending?.room.id).toBe('r2');
    expect(callFake.switchGroupCall).not.toHaveBeenCalled();
  });

  /** The host runs a session, sits in room 1, and the main room's roster is known. */
  async function hostInRoom({ autoAssign = true } = {}) {
    lkFake.setIdentity(HOST + ':h');
    lkFake.setMyMetadata(HOST_META);
    await liveInMain(hostUser);
    await store.startBreakout({
      channelName: 'Seminar',
      roomCount: 2,
      seats: [{ identity: BOB + ':seat1', pubkey: BOB, roomIndex: 1 }],
      autoAssign
    });
    await settle();
    const roomIds = rel.createBreakoutRoom.mock.calls.map((c) => c[1].id);
    const sub = liveSub();
    sub.stream.next(roster(roomIds[0], [HOST, BOB]));
    sub.stream.next(roster(roomIds[1], [HOST]));
    sub.stream.next(roster('main-id', [HOST, BOB, CAROL, DAVE]));
    sub.stream.next('EOSE');
    await settle();
    await store.joinBreakoutRoom(store.getBreakoutState().rooms[0]);
    await settle();
    expect(store.getBreakoutState().currentRoom?.id).toBe(roomIds[0]);
    rel.seatInRoom.mockClear();
    toast.fn.mockClear();
    return { roomIds, sub: liveSub() };
  }

  it('a host inside a room sees who waits in the main room, and seats a member there in the smallest room', async () => {
    const { roomIds, sub } = await hostInRoom();
    sub.stream.next(presence('main-id', [DAVE], 30));
    await settle();
    await settle();
    expect(store.getBreakoutState().mainPresence).toEqual([DAVE]);
    expect(toast.fn).toHaveBeenCalledWith(
      expect.stringContaining('arrived in the main room'),
      'info'
    );
    expect(rel.seatInRoom).toHaveBeenCalledWith(expect.anything(), roomIds[1], DAVE, hostUser);
    expect(rel.seatInRoom).toHaveBeenCalledTimes(1);
    // the same presence again: dealt with already
    sub.stream.next(presence('main-id', [DAVE], 31));
    await settle();
    expect(rel.seatInRoom).toHaveBeenCalledTimes(1);
    // a guest (not on the channel's roster) is only shown, never seated
    sub.stream.next(presence('main-id', [DAVE, 'e'.repeat(64)], 32));
    await settle();
    await settle();
    expect(store.getBreakoutState().mainPresence).toEqual([DAVE, 'e'.repeat(64)]);
    expect(rel.seatInRoom).toHaveBeenCalledTimes(1);
  });

  it('with auto-assign off the host is only told; "Hierher holen" seats the waiting members into the host\'s room', async () => {
    const { roomIds, sub } = await hostInRoom({ autoAssign: false });
    sub.stream.next(presence('main-id', [DAVE, 'e'.repeat(64)], 30));
    await settle();
    await settle();
    expect(toast.fn).toHaveBeenCalledTimes(1);
    expect(rel.seatInRoom).not.toHaveBeenCalled();
    await store.bringMainRoomHere();
    await settle();
    expect(rel.seatInRoom).toHaveBeenCalledWith(expect.anything(), roomIds[0], DAVE, hostUser);
    expect(rel.seatInRoom).toHaveBeenCalledTimes(1);
  });

  it('a seat in the main room is dealt with again after it left and came back', async () => {
    const { roomIds, sub } = await hostInRoom();
    sub.stream.next(presence('main-id', [DAVE], 30));
    await settle();
    await settle();
    sub.stream.next(presence('main-id', [], 31));
    await settle();
    sub.stream.next(roster(roomIds[1], [HOST], 32));
    sub.stream.next(presence('main-id', [DAVE], 33));
    await settle();
    await settle();
    expect(rel.seatInRoom).toHaveBeenCalledTimes(2);
  });
});

describe('room numbers from one-room messages', () => {
  it('a targeted assignment after the state keeps the room number it already knows', async () => {
    await liveInMain(bobUser);
    lk.listener?.(
      { t: 'state', rooms: ROOMS.map(({ id, relay, name }) => ({ id, relay, name })) },
      hostSender
    );
    expect(store.getBreakoutState().rooms.map((r) => [r.id, r.index])).toEqual([
      ['r1', 1],
      ['r2', 2]
    ]);
    // the host sends Bob to room 2 only: still room 2, not "room 1"
    lk.listener?.({ t: 'assign', rooms: [{ ...ROOMS[1], members: [BOB + ':seat1'] }] }, hostSender);
    expect(store.getBreakoutState().pending?.room.index).toBe(2);
    expect(store.getBreakoutState().rooms.map((r) => [r.id, r.index])).toEqual([
      ['r1', 1],
      ['r2', 2]
    ]);
  });

  it('a one-room assignment to a client that knows nothing yet takes the number from the name', async () => {
    await liveInMain(bobUser);
    lk.listener?.({ t: 'assign', rooms: [{ ...ROOMS[1], members: [BOB + ':seat1'] }] }, hostSender);
    expect(store.getBreakoutState().pending?.room.index).toBe(2);
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

  it('setBreakoutDeadline(minutes) starts one from now on a session without a deadline', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    await liveInMain(hostUser);
    await store.startBreakout({ channelName: 'Seminar', roomCount: 2, seats: [] });
    await settle();
    expect(store.getBreakoutState().remaining).toBeNull();
    const roomIds = rel.createBreakoutRoom.mock.calls.map((c) => c[1].id);
    lk.send.mockClear();
    await store.setBreakoutDeadline(10);
    expect(rel.editBreakoutUntil).toHaveBeenCalledTimes(2);
    expect(rel.editBreakoutUntil.mock.calls[1].slice(1, 3)).toEqual([
      { id: roomIds[1], parentId: 'main-id', channelName: 'Seminar', index: 2 },
      1_700_000_000 + 600
    ]);
    expect(store.getBreakoutState().session?.until).toBe(1_700_000_000 + 600);
    expect(store.getBreakoutState().remaining).toBe(600);
    expect(lk.send).toHaveBeenCalledWith({
      t: 'state',
      rooms: roomIds.map((id, i) => ({ id, relay: RELAY, name: `Breakout ${i + 1} · Seminar` })),
      until: 1_700_000_000 + 600
    });
    // and the extend case moves it on from there
    await store.extendBreakout(5);
    expect(store.getBreakoutState().session?.until).toBe(1_700_000_000 + 900);
    // nonsense minutes are ignored, nothing goes to the relay
    rel.editBreakoutUntil.mockClear();
    await store.setBreakoutDeadline(0);
    await store.setBreakoutDeadline(-3);
    expect(rel.editBreakoutUntil).not.toHaveBeenCalled();
  });

  it('setBreakoutDeadline(null) takes the deadline away: a null until per room, no countdown, the main room told', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    await liveInMain(hostUser);
    await store.startBreakout({
      channelName: 'Seminar',
      roomCount: 2,
      seats: [],
      durationMinutes: 3
    });
    await settle();
    expect(store.getBreakoutState().remaining).toBe(180);
    const roomIds = rel.createBreakoutRoom.mock.calls.map((c) => c[1].id);
    lk.send.mockClear();
    await store.setBreakoutDeadline(null);
    expect(rel.editBreakoutUntil).toHaveBeenCalledTimes(2);
    expect(rel.editBreakoutUntil.mock.calls[0][2]).toBeNull();
    expect(store.getBreakoutState().session?.until).toBeNull();
    expect(store.getBreakoutState().remaining).toBeNull();
    expect(lk.send).toHaveBeenCalledWith({
      t: 'state',
      rooms: roomIds.map((id, i) => ({ id, relay: RELAY, name: `Breakout ${i + 1} · Seminar` }))
    });
    // a refusal keeps what there was and names the reason
    await store.setBreakoutDeadline(5);
    rel.editBreakoutUntil.mockRejectedValueOnce(new Error('restricted'));
    await store.setBreakoutDeadline(null);
    expect(toast.fn).toHaveBeenCalledWith('deadline not set: restricted', 'error');
    expect(store.getBreakoutState().session?.until).toBe(1_700_000_000 + 300);
  });

  it('a cleared deadline reaches the main room (state without until) and the rooms (a 39000 without until)', async () => {
    // main room: bob holds a deadline, the host's state replay drops it
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
    expect(store.getBreakoutState().session?.until).toBe(FUTURE);
    lk.listener?.(
      { t: 'state', rooms: ROOMS.map(({ id, relay, name }) => ({ id, relay, name })) },
      hostSender
    );
    await settle();
    expect(store.getBreakoutState().session?.until).toBeNull();
    expect(store.getBreakoutState().remaining).toBeNull();
    // in a room: the newer 39000 of the room carries no until any more
    store.__resetBreakout();
    await liveInMain(bobUser);
    lk.listener?.({ t: 'assign', rooms: ROOMS, until: FUTURE }, hostSender);
    modal.callbacks.onConfirm();
    await settle();
    expect(store.getBreakoutState().currentRoom?.id).toBe('r1');
    const sub = liveSub();
    sub.stream.next(roomMeta('r1', 1, FUTURE, 11));
    await settle();
    expect(store.getBreakoutState().session?.until).toBe(FUTURE);
    sub.stream.next(roomMeta('r1', 1, null, 12));
    await settle();
    expect(store.getBreakoutState().session?.until).toBeNull();
    // an OLDER 39000 (a replay) never resurrects or drops anything
    sub.stream.next(roomMeta('r1', 1, FUTURE, 5));
    await settle();
    expect(store.getBreakoutState().session?.until).toBeNull();
  });
});

describe('call broadcasts (kind 20002)', () => {
  /** The subscription for the parent's broadcasts (the newest one open). */
  const broadcastSub = () =>
    relay.subs.filter((x) => !x.closed && x.filters[0]?.kinds?.[0] === 20002).at(-1);
  const broadcast = (type, content, extra = {}) => ({
    id: 'ev-' + Math.random().toString(36).slice(2, 8),
    kind: 20002,
    pubkey: HOST,
    created_at: Math.floor(Date.now() / 1000),
    content,
    tags: [
      ['h', 'main-id'],
      ['type', type]
    ],
    ...extra
  });

  it("subscribes to the parent's broadcasts while a session is known, in a room too, and stops with it", async () => {
    await liveInMain(bobUser);
    expect(broadcastSub()).toBeUndefined();
    lk.listener?.({ t: 'assign', rooms: ROOMS, until: FUTURE }, hostSender);
    await settle();
    const sub = broadcastSub();
    expect(sub.filters).toEqual([{ kinds: [20002], '#h': ['main-id'] }]);
    modal.callbacks.onConfirm();
    await settle();
    expect(broadcastSub()).toBe(sub); // the switch into the room keeps it
    lk.listener?.({ t: 'end' }, hostSender);
    await settle();
    expect(sub.closed).toBe(true);
  });

  it('renders a message as a toast naming the sender and a system line in the call chat, once', async () => {
    await liveInMain(bobUser);
    lk.listener?.({ t: 'assign', rooms: ROOMS, until: FUTURE }, hostSender);
    modal.callbacks.onCancel();
    await settle();
    const event = broadcast('message', 'two minutes left');
    broadcastSub().stream.next(event);
    broadcastSub().stream.next(event); // the relay sends it twice (two subscriptions, a reconnect)
    expect(toast.fn).toHaveBeenCalledTimes(1);
    expect(toast.fn).toHaveBeenCalledWith(`${HOST.slice(0, 8)}...: two minutes left`, 'info');
    expect(lkFake.addSystemCallChat).toHaveBeenCalledTimes(1);
    expect(lkFake.addSystemCallChat).toHaveBeenCalledWith({
      identity: HOST + ':relay',
      text: 'two minutes left',
      id: event.id
    });
    // another parent's broadcast, a malformed one, an empty one: nothing
    broadcastSub().stream.next(
      broadcast('message', 'x', {
        tags: [
          ['h', 'other'],
          ['type', 'message']
        ]
      })
    );
    broadcastSub().stream.next(broadcast('message', '   '));
    broadcastSub().stream.next({ kind: 20002, tags: [] });
    expect(toast.fn).toHaveBeenCalledTimes(1);
  });

  it('a countdown moves the deadline display and nothing else; a return toasts its text or the default', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    await liveInMain(bobUser);
    lk.listener?.({ t: 'assign', rooms: ROOMS, until: 1_700_000_000 + 600 }, hostSender);
    modal.callbacks.onCancel();
    await settle();
    expect(store.getBreakoutState().remaining).toBe(600);
    broadcastSub().stream.next(broadcast('countdown', '120'));
    await settle();
    expect(store.getBreakoutState().session?.until).toBe(1_700_000_000 + 120);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getBreakoutState().remaining).toBe(119);
    expect(toast.fn).not.toHaveBeenCalled();
    expect(lkFake.addSystemCallChat).not.toHaveBeenCalled();
    // within two seconds of our own clock: left alone
    broadcastSub().stream.next(broadcast('countdown', '118'));
    expect(store.getBreakoutState().session?.until).toBe(1_700_000_000 + 120);

    broadcastSub().stream.next(broadcast('return', ''));
    expect(toast.fn).toHaveBeenLastCalledWith(`${HOST.slice(0, 8)}...: please come back`, 'info');
    broadcastSub().stream.next(broadcast('return', 'wrap-up in the main room'));
    expect(toast.fn).toHaveBeenLastCalledWith(
      `${HOST.slice(0, 8)}...: wrap-up in the main room`,
      'info'
    );
    expect(lkFake.addSystemCallChat).toHaveBeenCalledTimes(2);
  });

  it("the host sends a message to the group relay with the parent's h tag and sees its own copy once", async () => {
    await liveInMain(hostUser);
    await store.startBreakout({ channelName: 'Seminar', roomCount: 2, seats: [] });
    await settle();
    expect(await store.sendCallBroadcast('message', 'hello rooms')).toBe(true);
    const [, template, user] = relayPublish.fn.mock.calls[0];
    expect(user).toBe(hostUser);
    expect(template).toMatchObject({
      kind: 20002,
      content: 'hello rooms',
      tags: [
        ['h', 'main-id'],
        ['type', 'message']
      ]
    });
    expect(toast.fn).toHaveBeenCalledWith(`${HOST.slice(0, 8)}...: hello rooms`, 'info');
    expect(lkFake.addSystemCallChat).toHaveBeenCalledTimes(1);
    // the relay's echo of the same event changes nothing
    const [signed] = relayPublish.fn.mock.results.map((r) => r.value);
    broadcastSub().stream.next(await signed);
    expect(toast.fn).toHaveBeenCalledTimes(1);
    // not hosting: nothing goes out
    store.__resetBreakout();
    expect(await store.sendCallBroadcast('message', 'x')).toBe(false);
  });

  it('a relay that refuses the kind (an old pyramid) is reported with its reason', async () => {
    await liveInMain(hostUser);
    await store.startBreakout({ channelName: 'Seminar', roomCount: 2, seats: [] });
    relayPublish.fn.mockRejectedValueOnce(new Error('blocked: kind 20002 not allowed'));
    expect(await store.sendCallBroadcast('message', 'hello')).toBe(false);
    expect(toast.fn).toHaveBeenCalledWith('not sent: blocked: kind 20002 not allowed', 'error');
    expect(lkFake.addSystemCallChat).not.toHaveBeenCalled();
  });

  it('the host seat sends countdowns at 300, 120 and 60 s, once each, and again after +5 Min', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    lkFake.setIdentity(HOST + ':h');
    lkFake.setMyMetadata(HOST_META);
    await liveInMain(hostUser);
    await store.startBreakout({ channelName: 'S', roomCount: 2, seats: [], durationMinutes: 5.5 });
    await settle();
    const sent = () =>
      relayPublish.fn.mock.calls
        .filter((c) => c[1].kind === 20002)
        .map((c) => [c[1].tags[1][1], c[1].content]);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(sent()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(sent()).toEqual([['countdown', '300']]);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(sent()).toEqual([
      ['countdown', '300'],
      ['countdown', '120']
    ]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent()).toHaveLength(3);
    expect(sent()[2]).toEqual(['countdown', '60']);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent()).toHaveLength(3);
    // "+5 Min": the marks fire again on the way down
    await store.extendBreakout(5);
    await vi.advanceTimersByTimeAsync(41_000);
    expect(sent()).toHaveLength(4);
    expect(sent()[3][0]).toBe('countdown');
    expect(Number(sent()[3][1])).toBeLessThanOrEqual(300);
  });

  it('no countdowns from a client that does not hold the host seat, or sits in a room', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    await liveInMain(hostUser);
    await store.startBreakout({ channelName: 'S', roomCount: 2, seats: [], durationMinutes: 2 });
    await settle();
    await vi.advanceTimersByTimeAsync(119_000);
    expect(relayPublish.fn.mock.calls.filter((c) => c[1].kind === 20002)).toEqual([]);
  });

  it('"Alle zurueckholen" with the heads-up sends the return broadcast before deleting the rooms', async () => {
    await liveInMain(hostUser);
    await store.startBreakout({ channelName: 'S', roomCount: 2, seats: [] });
    await settle();
    await store.endBreakout({ notify: true });
    const [, template] = relayPublish.fn.mock.calls.find((c) => c[1].kind === 20002);
    expect(template.tags).toEqual([
      ['h', 'main-id'],
      ['type', 'return']
    ]);
    expect(template.content).toBe('please come back');
    expect(relayPublish.fn.mock.invocationCallOrder[0]).toBeLessThan(
      rel.deleteBreakoutRoom.mock.invocationCallOrder[0]
    );
    expect(store.getBreakoutState().session).toBeNull();
    // without the heads-up: no broadcast
    relayPublish.fn.mockClear();
    callFake.setCall({ pointer: MAIN, user: hostUser, phase: 'ready' });
    await store.startBreakout({ channelName: 'S', roomCount: 2, seats: [] });
    await store.endBreakout({ notify: false });
    expect(relayPublish.fn).not.toHaveBeenCalled();
  });
});

describe('guests (call-pass seats)', () => {
  const EVE = 'e'.repeat(64);
  const CODE = 'C'.repeat(22);
  const GUEST_META = JSON.stringify({ guest: true, pass: 'p1' });
  const eveUser = { pubkey: EVE, signer: { signEvent: vi.fn() } };
  const b64url = (/** @type {string} */ text) =>
    Buffer.from(text).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  /** A LiveKit token minted for `identity`. @param {string} identity */
  const tokenFor = (identity) => ({
    serverUrl: 'wss://lk.example',
    participantToken: `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub: identity }))}.s`
  });

  /** Eve joined the main room through a guest link: a guest seat with the code kept. */
  async function guestInMain() {
    lkFake.setIdentity(EVE + ':g1');
    lkFake.setMyMetadata(GUEST_META);
    callFake.setCall({
      pointer: MAIN,
      user: eveUser,
      title: 'Seminar',
      phase: 'ready',
      code: CODE
    });
    await store.ensureBreakoutListener();
    await settle();
    lkApi.requestGroupCallToken.mockResolvedValue(tokenFor(EVE + ':r1'));
  }

  /** The host runs a two-room session and holds the host seat. */
  async function hostingWithSeat() {
    lkFake.setIdentity(HOST + ':h');
    lkFake.setMyMetadata(HOST_META);
    await liveInMain(hostUser);
    await store.startBreakout({ channelName: 'Seminar', roomCount: 2, seats: [] });
    await settle();
    const roomIds = rel.createBreakoutRoom.mock.calls.map((c) => c[1].id);
    const sub = liveSub();
    sub.stream.next(roster(roomIds[0], [HOST]));
    sub.stream.next(roster(roomIds[1], [HOST]));
    sub.stream.next('EOSE');
    await settle();
    rel.seatInRoom.mockClear();
    lk.send.mockClear();
    return { roomIds, sub };
  }

  it('the host never seats a guest: the assignment names its identity, no put-user', async () => {
    await liveInMain(hostUser);
    await store.startBreakout({
      channelName: 'Seminar',
      roomCount: 2,
      seats: [
        { identity: BOB + ':seat1', pubkey: BOB, roomIndex: 1 },
        { identity: EVE + ':g1', pubkey: EVE, roomIndex: 1, guest: true }
      ]
    });
    const roomIds = rel.createBreakoutRoom.mock.calls.map((c) => c[1].id);
    expect(rel.seatInRoom.mock.calls.map((c) => [c[1], c[2]])).toEqual([[roomIds[0], BOB]]);
    const [payload] = lk.send.mock.calls[0];
    expect(payload.rooms[0].members).toEqual([BOB + ':seat1', EVE + ':g1']);
  });

  it('an assigned guest requests the room token with its code, announces its seat and switches with code and token', async () => {
    await guestInMain();
    lk.listener?.({ t: 'assign', rooms: [{ ...ROOMS[0], members: [EVE + ':g1'] }] }, hostSender);
    modal.callbacks.onConfirm();
    await settle();
    expect(lkApi.requestGroupCallToken).toHaveBeenCalledWith(
      'wss://groups.example/',
      'r1',
      eveUser,
      {
        code: CODE
      }
    );
    // the seat announcement went out to the main room BEFORE the switch
    expect(lk.send).toHaveBeenCalledWith({ t: 'seat', room: 'r1', identity: EVE + ':r1' });
    expect(lk.send.mock.invocationCallOrder[0]).toBeLessThan(
      callFake.switchGroupCall.mock.invocationCallOrder[0]
    );
    expect(callFake.switchGroupCall).toHaveBeenCalledWith(
      { id: 'r1', relay: RELAY },
      { title: 'Breakout 1 · Seminar', code: CODE, token: tokenFor(EVE + ':r1') }
    );
    expect(store.getBreakoutState().currentRoom?.id).toBe('r1');
    expect(rel.seatInRoom).not.toHaveBeenCalled();
  });

  it('a refused room token (an old relay) keeps the guest in the main room and says why', async () => {
    await guestInMain();
    const { GroupCallTokenError } = await import('$lib/groups/livekit.js');
    lkApi.requestGroupCallToken.mockRejectedValue(
      new GroupCallTokenError('pass', 'call pass unknown', 403)
    );
    lk.listener?.({ t: 'assign', rooms: [{ ...ROOMS[0], members: [EVE + ':g1'] }] }, hostSender);
    modal.callbacks.onConfirm();
    await settle();
    expect(callFake.switchGroupCall).not.toHaveBeenCalled();
    expect(lk.send).not.toHaveBeenCalled();
    expect(store.getBreakoutState().currentRoom).toBeNull();
    expect(store.getBreakoutState().session).not.toBeNull();
    expect(toast.fn).toHaveBeenCalledWith('switch failed: call pass unknown', 'error');
  });

  it('in a room a guest follows no roster: it stays although no 39002 names it', async () => {
    vi.useFakeTimers();
    await guestInMain();
    lk.listener?.({ t: 'assign', rooms: [{ ...ROOMS[0], members: [EVE + ':g1'] }] }, hostSender);
    modal.callbacks.onConfirm();
    await settle();
    callFake.switchGroupCall.mockClear();
    const sub = liveSub();
    expect(sub.filters[0]).toEqual({ kinds: [39000, 39002, 39004], '#d': ['r1'] });
    sub.stream.next(roster('r1', [HOST, BOB]));
    sub.stream.next('EOSE');
    await settle();
    await vi.advanceTimersByTimeAsync(BREAKOUT_MOVE_GRACE_MS + 100);
    await settle();
    expect(callFake.switchGroupCall).not.toHaveBeenCalled();
    expect(store.getBreakoutState().currentRoom?.id).toBe('r1');
    // but the room's 39000 (a moved deadline) and its deletion do count
    sub.stream.next(roomMeta('r1', 1, FUTURE + 60, 11));
    await settle();
    expect(store.getBreakoutState().session?.until).toBe(FUTURE + 60);
    sub.stream.next({ kind: 9008, pubkey: KEY, created_at: 12, tags: [['h', 'r1']] });
    await settle();
    expect(callFake.switchGroupCall).toHaveBeenCalledWith(MAIN, { title: 'Seminar', code: CODE });
  });

  it('removed from a room by the host, a guest goes back to the main room with its code — never the end screen', async () => {
    await guestInMain();
    lk.listener?.({ t: 'assign', rooms: [{ ...ROOMS[0], members: [EVE + ':g1'] }] }, hostSender);
    modal.callbacks.onConfirm();
    await settle();
    callFake.switchGroupCall.mockClear();
    lkFake.setDisconnectReason(lkFake.PARTICIPANT_REMOVED);
    callFake.setCall({ pointer: { id: 'r1', relay: RELAY }, phase: 'ended' });
    await settle();
    expect(callFake.switchGroupCall).toHaveBeenCalledWith(MAIN, { title: 'Seminar', code: CODE });
    expect(store.getBreakoutState().currentRoom).toBeNull();
    expect(store.getBreakoutState().session).not.toBeNull();
    expect(toast.fn).toHaveBeenCalledWith('taken out, back in main', 'info');
  });

  it('"Beitreten" from the banner switches a guest right away: no seat, no request to the host', async () => {
    await guestInMain();
    lk.listener?.(
      { t: 'state', rooms: ROOMS.map(({ id, relay, name }) => ({ id, relay, name })) },
      hostSender
    );
    await settle();
    lk.send.mockClear();
    await store.requestBreakoutRoom(store.getBreakoutState().rooms[1]);
    await settle();
    expect(rel.seatInRoom).not.toHaveBeenCalled();
    expect(lk.send.mock.calls.map((c) => c[0].t)).toEqual(['seat']);
    expect(store.getBreakoutState().joinRequest).toBeNull();
    expect(callFake.switchGroupCall).toHaveBeenCalledWith(
      { id: 'r2', relay: RELAY },
      expect.objectContaining({ title: 'Breakout 2 · Seminar', code: CODE })
    );
  });

  it('the host records a seat announcement only from a guest whose pubkey matches', async () => {
    const { roomIds } = await hostingWithSeat();
    const guestSender = { identity: EVE + ':g1', metadata: GUEST_META };
    lk.listener?.({ t: 'seat', room: roomIds[0], identity: BOB + ':x' }, guestSender); // not Eve's
    lk.listener?.(
      { t: 'seat', room: roomIds[0], identity: BOB + ':x' },
      { identity: BOB + ':m', metadata: '' }
    ); // a member
    lk.listener?.({ t: 'seat', room: 'nope', identity: EVE + ':zz' }, guestSender); // unknown room
    expect(store.getBreakoutState().guestSeats).toEqual({});
    lk.listener?.({ t: 'seat', room: roomIds[0], identity: EVE + ':zz' }, guestSender);
    expect(store.getBreakoutState().guestSeats).toEqual({
      [EVE]: { roomId: roomIds[0], identity: EVE + ':zz' }
    });
  });

  it('moving a guest between rooms: remove on the child with the announced identity, then the next assignment when it reappears', async () => {
    vi.useFakeTimers();
    const { roomIds } = await hostingWithSeat();
    lk.listener?.(
      { t: 'seat', room: roomIds[0], identity: EVE + ':zz' },
      { identity: EVE + ':g1', metadata: GUEST_META }
    );
    await store.moveParticipant({ pubkey: EVE, identities: [], toRoomId: roomIds[1], guest: true });
    expect(lkApi.moderateCall).toHaveBeenCalledWith({ id: roomIds[0], relay: RELAY }, hostUser, {
      action: 'remove',
      identity: EVE + ':zz'
    });
    expect(rel.seatInRoom).not.toHaveBeenCalled();
    expect(rel.unseatFromRoom).not.toHaveBeenCalled();
    expect(lk.send).not.toHaveBeenCalled();
    expect(store.getBreakoutState().guestSeats).toEqual({});
    expect(store.__pendingGuestMoves().get(EVE)).toBe(roomIds[1]);
    // Eve's client came back to the main room: the host seat answers with room 2 only
    lk.joined?.({ identity: EVE + ':g2', metadata: GUEST_META });
    await settle();
    await settle();
    expect(store.__pendingGuestMoves().has(EVE)).toBe(false);
    expect(lk.send).toHaveBeenCalledTimes(1);
    const [assign, to] = lk.send.mock.calls[0];
    expect(to).toEqual([EVE + ':g2']);
    expect(assign).toEqual({
      t: 'assign',
      rooms: [
        { id: roomIds[1], relay: RELAY, name: 'Breakout 2 · Seminar', members: [EVE + ':g2'] }
      ]
    });
    expect(rel.seatInRoom).not.toHaveBeenCalled();
  });

  it('a guest that does not come back within 20 s is given up on, with a toast', async () => {
    vi.useFakeTimers();
    const { roomIds } = await hostingWithSeat();
    lk.listener?.(
      { t: 'seat', room: roomIds[0], identity: EVE + ':zz' },
      { identity: EVE + ':g1', metadata: GUEST_META }
    );
    await store.moveParticipant({ pubkey: EVE, identities: [], toRoomId: roomIds[1], guest: true });
    await vi.advanceTimersByTimeAsync(store.BREAKOUT_GUEST_MOVE_TIMEOUT_MS + 10);
    expect(store.__pendingGuestMoves().has(EVE)).toBe(false);
    expect(toast.fn).toHaveBeenCalledWith('guest did not come back', 'error');
  });

  it('"back to the main room" for a guest is the remove alone, and the returning guest is not auto-assigned again', async () => {
    const { roomIds } = await hostingWithSeat();
    lk.listener?.(
      { t: 'seat', room: roomIds[0], identity: EVE + ':zz' },
      { identity: EVE + ':g1', metadata: GUEST_META }
    );
    await store.moveParticipant({ pubkey: EVE, identities: [], toRoomId: null, guest: true });
    expect(lkApi.moderateCall).toHaveBeenCalledWith({ id: roomIds[0], relay: RELAY }, hostUser, {
      action: 'remove',
      identity: EVE + ':zz'
    });
    expect(store.__pendingGuestMoves().size).toBe(0);
    lk.joined?.({ identity: EVE + ':g2', metadata: GUEST_META });
    await settle();
    await settle();
    // auto-assign is on, but someone just sent home stays home: only the state replay
    expect(lk.send.mock.calls.map((c) => c[0].t)).toEqual(['state']);
  });

  it('a guest still in the main room is moved by a targeted assignment only; the relay refusal of a remove is toasted', async () => {
    const { roomIds } = await hostingWithSeat();
    await store.moveParticipant({
      pubkey: EVE,
      identities: [EVE + ':g1'],
      toRoomId: roomIds[0],
      guest: true
    });
    expect(lkApi.moderateCall).not.toHaveBeenCalled();
    expect(rel.seatInRoom).not.toHaveBeenCalled();
    const [assign, to] = lk.send.mock.calls[0];
    expect(to).toEqual([EVE + ':g1']);
    expect(assign.rooms[0]).toMatchObject({ id: roomIds[0], members: [EVE + ':g1'] });

    lk.listener?.(
      { t: 'seat', room: roomIds[0], identity: EVE + ':zz' },
      { identity: EVE + ':g1', metadata: GUEST_META }
    );
    lkApi.moderateCall.mockRejectedValueOnce(new Error('only the host or a co-host may do this'));
    await store.moveParticipant({ pubkey: EVE, identities: [], toRoomId: roomIds[1], guest: true });
    expect(toast.fn).toHaveBeenCalledWith(
      'guest not moved: only the host or a co-host may do this',
      'error'
    );
    expect(store.__pendingGuestMoves().size).toBe(0);
    expect(store.getBreakoutState().busy).toBe(false);
  });

  it('a member the host sent back to the main room is not auto-assigned again either', async () => {
    const { roomIds, sub } = await hostingWithSeat();
    sub.stream.next(roster(roomIds[0], [HOST, BOB], 11));
    await settle();
    await store.moveParticipant({ pubkey: BOB, toRoomId: null });
    expect(rel.unseatFromRoom).toHaveBeenCalledWith(expect.anything(), roomIds[0], BOB, hostUser);
    sub.stream.next(roster(roomIds[0], [HOST], 12));
    await settle();
    lk.joined?.({ identity: BOB + ':seat2', metadata: '' });
    await settle();
    await settle();
    expect(rel.seatInRoom).not.toHaveBeenCalled();
    expect(lk.send.mock.calls.map((c) => c[0].t)).toEqual(['state']);
  });
});
