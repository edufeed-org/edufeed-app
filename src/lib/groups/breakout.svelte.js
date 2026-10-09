// Breakout rooms — the one breakout session this client knows about.
//
// A host or co-host of a channel call creates one hidden NIP-29 AV sub-group
// per room on the channel's relay (breakout-relay.js), seats the assigned
// people with put-user and tells the seats in the main room where to go with
// a LiveKit data message on `edufeed.call.breakout` (breakout.js). A client
// that finds its own seat in a room is asked (or auto-switches after a few
// seconds) and moves its live call there without the lobby, mic and camera
// as they were (group-call.svelte.js `switchGroupCall`).
//
// The rooms are EPHEMERAL GROUPS (docs/nips/nip29-ephemeral-groups.md): the
// relay owns their end of life — it deletes a room when its LiveKit room
// finishes, never starts, passes `until`, or loses its parent — and lets the
// parent's current call host and co-hosts moderate them. The client still
// deletes rooms when a host ends the session, so nobody waits for the
// sweeper, and still returns at the deadline on its own (a relay without the
// extension behaves like the first implementation).
//
// While in a room a client FOLLOWS the relay, not the host's data messages
// (the SFU of the main room no longer reaches it):
//   (a) its own membership of the room (kind 39002): gone → back to the main
//       room — after a short grace, because a MOVE is remove-user + put-user
//       and (b) another room's roster naming it means "go there instead";
//   (c) the room's kind 39000 tombstone, a kind 9008, or the LiveKit
//       disconnect that follows the relay's DeleteRoom: the session is over
//       for this room → back to the main room;
//   (d) the deadline from the room's `until` / assignment: countdown in the
//       header, back to the main room at zero (whoever holds the host seat
//       deletes the rooms then).
//
// Late joiners of the main room learn about a running session two ways:
// the relay's `#ephemeral` read of the parent (the extension), and the
// client holding the HOST SEAT replaying `{t:'state'}` to every newcomer —
// which also seats them into the smallest room when the host asked for
// that ("Nachzügler automatisch verteilen"), or else leaves them a banner
// with the rooms to join (a join is a request to the host seat, which
// seats and assigns them). The host's client may sit in a breakout room,
// out of reach of the main room's data channel (laoc 2026-10-09: a late
// joiner saw nothing, the host heard nothing) — so everything a late
// joiner and the host need also goes through the relay: a member knocks
// on a room with their own kind 9021 (the relay seats them, v1.18+); a
// room roster (39002) that names a main-room seat IS its assignment; and
// the main room's 39004 tells the host who waits there — a toast, a pill
// with "Hierher holen", and the smallest room when auto-assign is on
// (members only: a guest is on no roster and moves by message, from the
// main room). Every host / co-host client keeps the session;
// when the relay hands the host seat to one of them (the host left), that
// client takes over: panel, newcomers, deadline, moving and ending — the
// relay enforces the rights per the extension.
//
// Call broadcasts (kind 20002, call-broadcasts.js): the host seat tells
// every room something through the relay — a free-text `message`, the
// automatic `countdown` at 300 / 120 / 60 s before the deadline, a `return`
// heads-up before "Alle zurueckholen". Every client with a session (main
// room or breakout room) subscribes for its duration and renders a toast
// naming the sender plus a local system line in the room's call chat; a
// countdown only moves the deadline display.
//
// Guests (call-pass seats, docs/nips/nip29-ephemeral-groups.md "Guests in
// ephemeral children"): assigned BY MESSAGE ONLY — never a put-user, a pass
// is a seat, not membership. The relay honours the parent's pass in its
// ephemeral children, so a guest's client switches with the same `code`
// and comes back with it. Before it leaves the main room it requests the
// room's token and announces the identity it will hold there (`seat`), so
// a host can take it out of the room again with the moderation endpoint's
// `remove` on the child — the only handle a host has on a seat that is on
// no roster. Removed from a child = back to the main room (never the
// "removed from the call" end state), where the host's client re-assigns
// it to the next room if that was a move. An old relay refuses the child
// token: the guest stays in the main room and is told.
import { untrack } from 'svelte';
import { normalizeURL } from 'applesauce-core/helpers/url';
import { getProfileContent } from 'applesauce-core/helpers';
import {
  GROUP_METADATA_KIND,
  GROUP_MEMBERS_KIND,
  DELETE_GROUP_KIND,
  getGroupMembers
} from 'applesauce-common/helpers/groups';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { modalStore } from '$lib/stores/modal.svelte.js';
import { showToast } from '$lib/helpers/toast';
import { unique } from '$lib/helpers/unique.js';
import { getUserDisplayName } from '$lib/helpers/message-utils.js';
import * as m from '$lib/paraglide/messages';
import { getBreakoutAutoAssign, setBreakoutAutoAssign } from '$lib/services/call-prefs.js';
import { generateGroupId, publishToGroupRelay } from './group-management.js';
import {
  buildCallBroadcastTemplate,
  callBroadcastFilter,
  countdownDue,
  parseCallBroadcast
} from './call-broadcasts.js';
import {
  getGroupCallState,
  getActiveCallPointer,
  getActiveCallUser,
  switchGroupCall,
  callErrorMessage
} from './group-call.svelte.js';
import {
  createBreakoutRoom,
  seatInRoom,
  unseatFromRoom,
  deleteBreakoutRoom,
  fetchEphemeralChildren,
  editBreakoutUntil,
  knockOnRoom
} from './breakout-relay.js';
import { raceRelayKey } from './relay-key-race.js';
import { isTrustedSigner } from './relay-directory.js';
import { CALL_PRESENCE_KIND, parseCallParticipants } from './call-presence.js';
import { channelDeleted } from './channel-access.js';
import {
  identityToPubkey,
  isGuestParticipant,
  participantCallRole,
  requestGroupCallToken,
  tokenIdentity,
  moderateCall
} from './livekit.js';
import {
  BREAKOUT_AUTO_SWITCH_MS,
  BREAKOUT_EXTEND_MINUTES,
  assignedRoom,
  breakoutRoomName,
  buildBreakoutAssignPayload,
  buildBreakoutEndPayload,
  buildBreakoutJoinPayload,
  buildBreakoutSeatPayload,
  buildBreakoutStatePayload,
  parseBreakoutMarker,
  parseBreakoutPayload,
  pickSmallestRoom,
  remainingSeconds,
  roomOfPubkey,
  roomsFromMetadataEvents
} from './breakout.js';

/** How long a seat that vanished from its room waits for a put-user elsewhere. */
export const BREAKOUT_MOVE_GRACE_MS = 2500;
/** How long a join request to the host seat waits for the assignment. */
export const BREAKOUT_JOIN_REQUEST_TIMEOUT_MS = 10_000;
/** How long a guest taken out of a room has to reappear in the main room for the next assignment. */
export const BREAKOUT_GUEST_MOVE_TIMEOUT_MS = 20_000;
/** Someone the host sent back to the main room is not auto-assigned again within this window. */
const SENT_HOME_GRACE_MS = 60_000;

/**
 * @typedef {{id: string, relay: string, name: string, index: number}} BreakoutRoom
 * @typedef {{
 *   main: {id: string, relay: string, title: string},
 *   rooms: BreakoutRoom[],
 *   until: number | null,
 *   hosting: boolean,
 *   creator: boolean,
 *   autoAssign: boolean,
 *   channelName: string
 * }} BreakoutSession
 *   `hosting`: this client manages the session (started it, or took the
 *   host seat over while it ran); `creator`: this client created the rooms;
 *   `autoAssign`: newcomers to the main room are seated by this client when
 *   it holds the host seat.
 */

/** @type {BreakoutSession | null} */
let session = $state.raw(null);
/** @type {BreakoutRoom | null} the room this client's call is in */
let currentRoom = $state.raw(null);
/** @type {Record<string, Set<string>>} room id -> pubkeys (kind 39002) */
let membersByRoomId = $state.raw({});
/** @type {Record<string, string[]>} room id -> pubkeys live in the call (kind 39004) */
let presenceByRoomId = $state.raw({});
/** @type {string[]} pubkeys live in the MAIN room (its kind 39004) while a session is known */
let mainPresence = $state.raw([]);
/** @type {Set<string>} the channel's roster (its kind 39002): a main-room seat not on it is a guest ($state.raw: replaced wholesale, never mutated) */
let mainMembers = $state.raw(new Set());
/** @type {string | null} the room a roster last asked this main-room seat into (asked once per room) */
let rosterOfferedRoomId = null;
/** @type {Set<string>} main-room arrivals this hosting client dealt with from a room (a leave forgets); plain bookkeeping, nothing renders it */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- not reactive on purpose
let arrivedInMain = new Set();
/** @type {Set<string>} rooms the relay reported deleted ($state.raw: replaced wholesale, never mutated) */
let goneRoomIds = $state.raw(new Set());
// The relay answered the roster request at least once (EOSE): only then is
// "my pubkey is not in my room's roster" a fact and not a pending fetch.
let rostersAnswered = $state(false);
/** @type {number | null} seconds left until the deadline */
let remaining = $state(null);
let busy = $state(false);
/** @type {{room: BreakoutRoom} | null} the assignment awaiting an answer */
let pending = $state.raw(null);
/** @type {{roomId: string} | null} the room this seat asked the host seat for */
let joinRequest = $state.raw(null);
/**
 * Guests in rooms, as they announced themselves (`seat`): pubkey -> the
 * room and the LiveKit identity held there. Guests are on no roster, so
 * this is the host's only handle on them (the moderation endpoint matches
 * identities exactly). Forgotten when the guest shows up in the main room.
 * @type {Record<string, {roomId: string, identity: string}>}
 */
let guestSeats = $state.raw({});
// The connection service has been loaded: effects that read its state wait
// for this (the module itself is a plain let).
let lkReady = $state(false);

// Plain lets: bookkeeping, never rendered.
/** @type {typeof import('$lib/services/livekit-connection.svelte.js') | null} */
let lkModule = null;
/** @type {Promise<typeof import('$lib/services/livekit-connection.svelte.js')> | null} */
let lkLoading = null;
/** @type {(() => void) | null} */
let stopListener = null;
/** @type {(() => void) | null} */
let stopJoinedListener = null;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let returnTimer;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let joinTimer;
// A switch leaves one call before joining the next: the store must not read
// that idle moment as "the user left the call".
// A room switch in flight (into a room or back): the call passes through
// idle and the pointer changes, and the views must not read that as the
// call ending. Reactive for the guest landing; the store's own effects
// read it untracked (the switch, not its flag, drives them).
let switching = $state(false);
let deadlineHandled = false;
/** @type {Record<string, number>} newest created_at seen per room id and kind */
let newestSeen = {};
// The call (pointer key) whose running session was looked up on the relay,
// so a re-render never asks twice for the same call.
/** @type {string | null} */
let discoveredFor = null;
/** Broadcast ids already rendered (our own copy + the relay's echo = one). @type {Set<string>} */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
let seenBroadcasts = new Set();
/** Countdown marks this host seat has sent for the current deadline. @type {Set<number>} */

let countdownSent = new Set();
/**
 * Guests this client took out of a room to send them to another: pubkey ->
 * the target, answered with a targeted assignment when the guest's new seat
 * appears in the main room, dropped after BREAKOUT_GUEST_MOVE_TIMEOUT_MS.
 * @type {Map<string, {toRoomId: string, timer: ReturnType<typeof setTimeout>}>}
 */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
let guestMoves = new Map();
/** Pubkeys this client sent back to the main room, with when (no auto re-assign). @type {Map<string, number>} */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
let sentHome = new Map();

/**
 * @returns {{
 *   session: BreakoutSession | null,
 *   currentRoom: BreakoutRoom | null,
 *   rooms: BreakoutRoom[],
 *   membersByRoomId: Record<string, Set<string>>,
 *   presenceByRoomId: Record<string, string[]>,
 *   mainPresence: string[],
 *   mainMembers: Set<string>,
 *   remaining: number | null,
 *   busy: boolean,
 *   pending: {room: BreakoutRoom} | null,
 *   joinRequest: {roomId: string} | null,
 *   guestSeats: Record<string, {roomId: string, identity: string}>,
 *   switching: boolean
 * }}
 */
export function getBreakoutState() {
  return {
    /** a switch into a room or back is in flight */
    get switching() {
      return switching;
    },
    get guestSeats() {
      return guestSeats;
    },
    get session() {
      return session;
    },
    get currentRoom() {
      return currentRoom;
    },
    /** the rooms still standing */
    get rooms() {
      return (session?.rooms ?? []).filter((room) => !goneRoomIds.has(room.id));
    },
    get membersByRoomId() {
      return membersByRoomId;
    },
    get presenceByRoomId() {
      return presenceByRoomId;
    },
    /** who is in the main room right now (its kind 39004), this seat included */
    get mainPresence() {
      return mainPresence;
    },
    /** the channel's roster: a main-room seat not on it is a guest */
    get mainMembers() {
      return mainMembers;
    },
    get remaining() {
      return remaining;
    },
    get busy() {
      return busy;
    },
    get pending() {
      return pending;
    },
    get joinRequest() {
      return joinRequest;
    }
  };
}

/**
 * Make sure the breakout listener is registered with the connection service
 * (loaded on demand — never statically, see group-call.svelte.js). The watch
 * below does this on every live call; the stage calls it on mount too.
 */
export function ensureBreakoutListener() {
  return loadConnection().then(() => undefined);
}

function loadConnection() {
  if (lkModule) return Promise.resolve(lkModule);
  lkLoading ??= import('$lib/services/livekit-connection.svelte.js').then((lk) => {
    lkModule = lk;
    stopListener?.();
    stopListener = lk.onBreakoutMessage(handleMessage);
    stopJoinedListener?.();
    stopJoinedListener = lk.onParticipantJoined?.((p) => void onNewcomer(p)) ?? null;
    lkReady = true;
    return lk;
  });
  return lkLoading;
}

/**
 * Whether the relay marked OUR seat in the current Room as the call host
 * (participant metadata `{"host":true}` — pushed mid-call on a hand-over).
 * Reactive when read inside an effect: it reads the connection service's
 * metadata version.
 */
function holdsHostSeat() {
  if (!lkReady || !lkModule) return false;
  const lk = lkModule.getLiveKitState();
  void lk.participantMetadataVersion;
  return participantCallRole(lk.localParticipant) === 'host';
}

/**
 * Whether OUR seat is a guest seat. The relay decides, not the link: a
 * member who opened a guest link gets a member token (the code is ignored
 * for members, docs/nips/nip29-call-passes.md) and only a guest token
 * carries `{"guest":true}` in the participant metadata — so while a seat
 * is up, its metadata is the answer, whatever code the call was joined
 * with. Only while no Room is up (the token in flight, a room the relay
 * tore down) is the call pass code the best guess (group-call.svelte.js
 * keeps it). Reactive inside an effect.
 */
function seatIsGuest() {
  if (lkReady && lkModule) {
    const lk = lkModule.getLiveKitState();
    void lk.participantMetadataVersion;
    const local = lk.localParticipant;
    if (local) return isGuestParticipant(local);
  }
  return !!getGroupCallState().code;
}

/** The call pass code our guest seat travels with (undefined for a member). */
function guestCode() {
  return seatIsGuest() ? (getGroupCallState().code ?? undefined) : undefined;
}

function clearGuestMoves() {
  for (const move of guestMoves.values()) clearTimeout(move.timer);
  guestMoves = new Map();
}

function clearSession() {
  clearTimeout(returnTimer);
  clearTimeout(joinTimer);
  clearGuestMoves();
  sentHome = new Map();
  guestSeats = {};
  session = null;
  currentRoom = null;
  membersByRoomId = {};
  presenceByRoomId = {};
  mainPresence = [];
  mainMembers = new Set();
  rosterOfferedRoomId = null;
  arrivedInMain = new Set();
  goneRoomIds = new Set();
  rostersAnswered = false;
  remaining = null;
  deadlineHandled = false;
  newestSeen = {};
  joinRequest = null;

  seenBroadcasts = new Set();

  countdownSent = new Set();
  if (pending) {
    pending = null;
    if (modalStore.activeModal === 'breakoutAssignment') modalStore.closeModal();
  }
}

/** The channel's name as this client names rooms after it. @param {BreakoutRoom[]} rooms */
function channelNameOf(rooms) {
  const name = rooms[0]?.name ?? '';
  return name.replace(/^Breakout \d+ · /, '');
}

/**
 * Merge rooms a host told us about (an assignment, a state replay) or the
 * relay listed into the non-hosting session view. A targeted assignment (a
 * later move from the main room) carries only its one room; the rooms
 * already known are kept.
 * @param {Array<{id: string, relay: string, name: string, index?: number}>} rooms
 * @param {number | null | undefined} until
 */
function learnRooms(rooms, until) {
  const pointer = getActiveCallPointer();
  if (!pointer) return;
  const known = session?.rooms ?? [];
  // A room's number: what the relay said, else what this client already
  // knows about the room, else the number in its name (`Breakout N · …`),
  // else its position in the message. A targeted assignment names ONE room
  // — without the fallbacks a later move to room 2 would read "Raum 1".
  const incoming = rooms.map((room, i) => ({
    id: room.id,
    relay: room.relay,
    name: room.name,
    index:
      room.index ??
      known.find((r) => r.id === room.id)?.index ??
      (Number(/^Breakout (\d+)\b/.exec(room.name)?.[1]) || i + 1)
  }));
  const merged = [...known.filter((r) => !incoming.some((n) => n.id === r.id)), ...incoming].sort(
    (a, b) => a.index - b.index
  );
  session = {
    main: session?.main ?? {
      id: pointer.id,
      relay: pointer.relay,
      title: getGroupCallState().title
    },
    rooms: merged,
    // Every assign / state payload carries the host's whole deadline (a
    // missing one IS "no deadline" — a cleared limit must reach the main
    // room too), only the relay's listing may leave it to what is known.
    until: until === undefined ? (session?.until ?? null) : until,
    hosting: false,
    creator: false,
    autoAssign: false,
    channelName: session?.channelName || channelNameOf(merged)
  };
}

/**
 * A data message on the breakout topic from someone in the main room.
 * Assignments, state and the end are believed only from a seat the relay
 * marked host or co-host (participant metadata — not forgeable by a
 * client); a join request from anyone is answered by the host seat.
 * @param {unknown} raw
 * @param {{identity: string, metadata?: string}} sender
 */
function handleMessage(raw, sender) {
  const payload = parseBreakoutPayload(raw);
  if (!payload) return;
  if (payload.t === 'join') {
    void answerJoinRequest(sender, payload.room);
    return;
  }
  if (payload.t === 'seat') {
    recordGuestSeat(sender, payload);
    return;
  }
  if (!participantCallRole(sender)) return;
  if (payload.t === 'end') {
    if (!session?.hosting) clearSession();
    return;
  }
  const pointer = getActiveCallPointer();
  if (!pointer || currentRoom) return;
  if (!session?.hosting) learnRooms(payload.rooms, payload.until);
  if (payload.t === 'state' || !session) return;
  const myIdentity = lkModule?.getLiveKitState().localParticipant?.identity;
  const mine = myIdentity ? assignedRoom(payload, myIdentity) : null;
  if (!mine) return;
  const room = session.rooms.find((r) => r.id === mine.id);
  if (!room) return;
  if (joinRequest?.roomId === room.id) {
    // The answer to my own "Beitreten": no need to ask me again.
    clearTimeout(joinTimer);
    joinRequest = null;
    void enterRoom(room);
    return;
  }
  // The roster may have asked already (the host seated me through the relay).
  if (pending?.room.id === room.id) return;
  offerAssignment(room);
}

/**
 * A guest about to move into a room tells the main room which identity it
 * will hold there. Believed only from a guest seat whose pubkey matches the
 * announced identity, for a room of the session; every client with a
 * session keeps it, so a co-host handed the host seat later knows it too.
 * @param {{identity: string, metadata?: string}} sender
 * @param {import('./breakout.js').BreakoutSeatPayload} payload
 */
function recordGuestSeat(sender, payload) {
  if (!session || !isGuestParticipant(sender)) return;
  const pubkey = identityToPubkey(sender.identity);
  if (!pubkey || identityToPubkey(payload.identity) !== pubkey) return;
  if (!session.rooms.some((room) => room.id === payload.room)) return;
  guestSeats = { ...guestSeats, [pubkey]: { roomId: payload.room, identity: payload.identity } };
}

/** @param {string} pubkey */
function forgetGuestSeat(pubkey) {
  if (!(pubkey in guestSeats)) return;
  const rest = { ...guestSeats };
  delete rest[pubkey];
  guestSeats = rest;
}

/** @param {BreakoutRoom} room */
function offerAssignment(room) {
  pending = { room };
  modalStore.openModal(
    'breakoutAssignment',
    { roomName: room.name, autoMs: BREAKOUT_AUTO_SWITCH_MS },
    { onConfirm: () => void acceptAssignment(), onCancel: () => declineAssignment() }
  );
}

/** "Wechseln": move into the room offered. */
export async function acceptAssignment() {
  const offer = pending;
  pending = null;
  if (modalStore.activeModal === 'breakoutAssignment') modalStore.closeModal();
  if (offer) await enterRoom(offer.room);
}

/** "Bleiben": stay in the main room (the host can still move you later). */
export function declineAssignment() {
  pending = null;
  if (modalStore.activeModal === 'breakoutAssignment') modalStore.closeModal();
}

/**
 * Move into a room. A guest seat first requests the room's token WHILE
 * still in the main room (the relay honours the parent's pass in its
 * ephemeral children) and announces the identity it will hold there to the
 * main room; a refusal (an old relay, a revoked pass) leaves the guest
 * where it is, with the relay's reason.
 * @param {BreakoutRoom} room
 */
async function enterRoom(room) {
  clearTimeout(returnTimer);
  const code = guestCode();
  /** @type {{serverUrl: string, participantToken: string} | undefined} */
  let token;
  if (code) {
    const user = getActiveCallUser();
    if (!user) return;
    try {
      token = await requestGroupCallToken(room.relay, room.id, user, { code });
    } catch (err) {
      console.warn('breakout room token refused for a guest:', err);
      showToast(m.groups_call_breakout_switch_failed({ reason: callErrorMessage(err) }), 'error');
      return;
    }
    const identity = tokenIdentity(token.participantToken);
    if (identity) {
      await lkModule
        ?.sendBreakoutMessage(buildBreakoutSeatPayload(room.id, identity))
        .catch((err) => console.warn('breakout seat not announced:', err));
    }
  }
  switching = true;
  currentRoom = room;
  try {
    await switchGroupCall(
      { id: room.id, relay: room.relay },
      { title: room.name, ...(code ? { code } : {}), ...(token ? { token } : {}) }
    );
  } finally {
    switching = false;
  }
  if (getGroupCallState().phase === 'error') {
    const err = getGroupCallState().error;
    showToast(
      m.groups_call_breakout_switch_failed({
        reason: err ? callErrorMessage(err) : m.groups_call_error_generic()
      }),
      'error'
    );
    await returnToMain();
  }
}

/** Back to the main room (any participant may, at any time). */
export async function returnToMain() {
  const s = session;
  clearTimeout(returnTimer);
  if (!s) return;
  const wasInRoom = currentRoom !== null;
  currentRoom = null;
  if (!wasInRoom) return;
  const code = guestCode();
  switching = true;
  try {
    await switchGroupCall(
      { id: s.main.id, relay: s.main.relay },
      { title: s.main.title, ...(code ? { code } : {}) }
    );
  } finally {
    switching = false;
  }
}

/** The host joins one of the rooms (as a plain participant there). @param {BreakoutRoom} room */
export async function joinBreakoutRoom(room) {
  if (!session) return;
  await enterRoom(room);
}

/**
 * "Beitreten" on the late-joiner banner: a seat in the main room wants into
 * a room of the running session. Seats itself when it may (a parent admin
 * on a relay with the extension, or someone already seated who stayed);
 * otherwise asks the host seat with a join request and switches when the
 * targeted assignment arrives. Without an answer the request lapses. A
 * guest needs no seat: its pass opens the room, so it switches right away.
 * @param {BreakoutRoom} room
 */
export async function requestBreakoutRoom(room) {
  const s = session;
  const user = getActiveCallUser();
  if (!s || currentRoom || joinRequest || !user) return;
  if (seatIsGuest() || membersByRoomId[room.id]?.has(user.pubkey)) {
    await enterRoom(room);
    return;
  }
  const relayConn = pool.relay(s.main.relay);
  try {
    await seatInRoom(relayConn, room.id, user.pubkey, user);
    await enterRoom(room);
    return;
  } catch {
    // not ours to seat — ask the host seat
  }
  const lk = await loadConnection();
  joinRequest = { roomId: room.id };
  clearTimeout(joinTimer);
  joinTimer = setTimeout(() => {
    if (joinRequest?.roomId !== room.id) return;
    joinRequest = null;
    showToast(m.groups_call_breakout_join_no_host(), 'error');
  }, BREAKOUT_JOIN_REQUEST_TIMEOUT_MS);
  // Two ways in, whichever answers first: knock on the room itself (the
  // relay seats a member of the channel — the roster then names me, the
  // watch below switches), and ask the host seat over the main room's data
  // channel (an older relay; a host sitting in the main room).
  let knocked = false;
  const knock = knockOnRoom(relayConn, room.id, user)
    .then(() => {
      knocked = true;
    })
    .catch((err) => console.warn('breakout room knock refused:', err));
  let asked = false;
  try {
    await lk.sendBreakoutMessage(buildBreakoutJoinPayload(room.id));
    asked = true;
  } catch (err) {
    console.warn('breakout join request not sent:', err);
  }
  await knock;
  if (!asked && !knocked && joinRequest?.roomId === room.id) {
    clearTimeout(joinTimer);
    joinRequest = null;
    showToast(m.groups_call_breakout_join_no_host(), 'error');
  }
}

/**
 * "Hierher holen" — the host, sitting in a room, seats every MEMBER waiting
 * in the main room into this room through the relay (a roster that names
 * them is their assignment; a seat elsewhere is given up). Guests are on no
 * roster: they move by message, from the main room.
 */
export async function bringMainRoomHere() {
  const s = session;
  const room = currentRoom;
  const user = getActiveCallUser();
  if (!s?.hosting || !room || !user) return;
  const waiting = mainPresence.filter((p) => p !== user.pubkey && mainMembers.has(p));
  if (waiting.length === 0) return;
  const relayConn = pool.relay(s.main.relay);
  const others = s.rooms.filter((r) => r.id !== room.id && !goneRoomIds.has(r.id));
  busy = true;
  try {
    for (const pubkey of waiting) {
      await seatInRoom(relayConn, room.id, pubkey, user);
      const from = roomOfPubkey(others, membersByRoomId, pubkey);
      if (from) await unseatFromRoom(relayConn, from.id, pubkey, user);
    }
  } catch (err) {
    console.warn('main room not fetched:', err);
    showToast(
      m.groups_call_breakout_move_failed({
        reason: err instanceof Error ? err.message : String(err)
      }),
      'error'
    );
  } finally {
    busy = false;
  }
}

/**
 * The host's client, sitting in a room, deals with a member who arrived in
 * the main room (the main room's 39004): a toast, and with auto-assign the
 * smallest room through the relay — the member's own client switches once
 * the roster names them. A seat already on a roster (a decline, a return)
 * is left alone, like one the host just sent home.
 * @param {string} pubkey @param {BreakoutSession} s @param {{pubkey: string, signer: any}} user
 */
async function seatArrivalFromRoom(pubkey, s, user) {
  showToast(m.groups_call_breakout_arrived_main({ name: nameOfPubkey(pubkey) }), 'info');
  if (!s.autoAssign) return;
  const home = sentHome.get(pubkey);
  if (home !== undefined && Date.now() - home < SENT_HOME_GRACE_MS) return;
  const rooms = s.rooms.filter((room) => !goneRoomIds.has(room.id));
  if (rooms.length === 0 || roomOfPubkey(rooms, membersByRoomId, pubkey)) return;
  const room = pickSmallestRoom(rooms, membersByRoomId, [user.pubkey]);
  if (!room) return;
  try {
    await seatInRoom(pool.relay(s.main.relay), room.id, pubkey, user);
  } catch (err) {
    console.warn('late joiner not seated from the room:', err);
  }
}

/**
 * The host seat answers a join request: seat the sender's pubkey in the
 * room and send the targeted assignment. Only the client that holds the
 * host seat acts, so a request is answered once.
 * @param {{identity: string, metadata?: string}} sender
 * @param {string} roomId
 */
async function answerJoinRequest(sender, roomId) {
  const s = session;
  const user = getActiveCallUser();
  if (!s?.hosting || !user || currentRoom || !holdsHostSeat()) return;
  if (isGuestParticipant(sender)) return;
  const room = s.rooms.find((r) => r.id === roomId && !goneRoomIds.has(r.id));
  const pubkey = identityToPubkey(sender.identity);
  if (!room || !pubkey) return;
  try {
    await seatInRoom(pool.relay(s.main.relay), room.id, pubkey, user);
    await lkModule?.sendBreakoutMessage(
      buildBreakoutAssignPayload({
        rooms: [{ ...room, members: [sender.identity] }],
        until: s.until
      }),
      [sender.identity]
    );
  } catch (err) {
    console.warn('breakout join request not answered:', err);
  }
}

/**
 * Someone joined the main room while a session runs and this client holds
 * the host seat: hand them the session (`state`), and — when the host asked
 * for it — a seat in the smallest room plus the assignment. A seat already
 * in a roster (a rejoin after a drop) is sent to that room again. A guest
 * is assigned by message only (no seat); one this client took out of a
 * room to move it gets its pending target instead. Someone this client
 * just sent back to the main room is left alone; so is our own second
 * seat.
 * @param {{identity: string, metadata?: string}} participant
 */
async function onNewcomer(participant) {
  const s = session;
  const user = getActiveCallUser();
  if (!s?.hosting || !user || currentRoom || !lkModule) return;
  const lk = lkModule;
  const guest = isGuestParticipant(participant);
  const pubkey = identityToPubkey(participant.identity);
  if (guest && pubkey) {
    // Back in the main room: whatever seat it held in a room is history.
    forgetGuestSeat(pubkey);
    const move = guestMoves.get(pubkey);
    if (move) {
      clearTimeout(move.timer);
      guestMoves.delete(pubkey);
      const to = s.rooms.find((room) => room.id === move.toRoomId && !goneRoomIds.has(room.id));
      if (to) {
        await lk
          .sendBreakoutMessage(
            buildBreakoutAssignPayload({
              rooms: [{ ...to, members: [participant.identity] }],
              until: s.until
            }),
            [participant.identity]
          )
          .catch((err) => console.warn('guest move not completed:', err));
      }
      return;
    }
  }
  if (!holdsHostSeat()) return;
  const rooms = s.rooms.filter((room) => !goneRoomIds.has(room.id));
  if (rooms.length === 0) return;
  try {
    await lk.sendBreakoutMessage(buildBreakoutStatePayload({ rooms, until: s.until }), [
      participant.identity
    ]);
  } catch (err) {
    console.warn('breakout state not replayed:', err);
    return;
  }
  if (!s.autoAssign) return;
  if (!pubkey || pubkey === user.pubkey) return;
  const home = sentHome.get(pubkey);
  if (home !== undefined && Date.now() - home < SENT_HOME_GRACE_MS) return;
  let room = guest ? null : roomOfPubkey(rooms, membersByRoomId, pubkey);
  try {
    if (!room) {
      room = pickSmallestRoom(rooms, membersByRoomId, [user.pubkey]);
      if (!room) return;
      if (!guest) await seatInRoom(pool.relay(s.main.relay), room.id, pubkey, user);
    }
    await lk.sendBreakoutMessage(
      buildBreakoutAssignPayload({
        rooms: [{ ...room, members: [participant.identity] }],
        until: s.until
      }),
      [participant.identity]
    );
  } catch (err) {
    console.warn('late joiner not seated:', err);
  }
}

/**
 * The relay's own key (NIP-11), to believe only its 39000s. Resolves with
 * `[]` ("no pin") when the relay does not tell.
 * @param {string} relay
 * @returns {Promise<string[]>}
 */
function relayAuthors(relay) {
  return new Promise((resolve) => {
    /** @type {string[]} */
    let authors = [];
    raceRelayKey(normalizeURL(relay), {
      onAuthors: (resolved) => {
        authors = resolved;
      },
      onReady: () => resolve(authors)
    });
  });
}

/**
 * The parent's live breakout rooms as the relay lists them (`#ephemeral`),
 * trusted to the relay's key. Empty on a relay without the extension.
 * @param {{id: string, relay: string}} pointer
 */
async function listRelayRooms(pointer) {
  const relay = normalizeURL(pointer.relay);
  const [authors, events] = await Promise.all([
    relayAuthors(relay),
    fetchEphemeralChildren(pool.relay(relay), pointer.id)
  ]);
  return roomsFromMetadataEvents(
    events.filter((event) => isTrustedSigner(event, authors)),
    pointer.id,
    pointer.relay
  );
}

/**
 * A late joiner of the main room asks the relay whether a session runs
 * (independent of the host seat's replay — either source fills the view).
 * @param {{id: string, relay: string}} pointer
 */
async function discoverSession(pointer) {
  let rooms;
  try {
    rooms = await listRelayRooms(pointer);
  } catch {
    return;
  }
  // Still the same call, still nothing known (the replay may have won)?
  const now = getActiveCallPointer();
  if (!now || now.id !== pointer.id || session || currentRoom || rooms.length === 0) return;
  const until = rooms.find((room) => room.until !== null)?.until ?? null;
  learnRooms(rooms, until);
}

/**
 * Create the rooms, seat everyone and send the assignment. Leftover
 * ephemeral rooms of this channel (a session whose host vanished before the
 * relay swept them) are deleted first, best effort.
 * @param {{
 *   channelName: string,
 *   roomCount: number,
 *   seats: Array<{identity: string, pubkey: string, roomIndex: number, guest?: boolean}>,
 *   durationMinutes?: number | null,
 *   autoAssign?: boolean
 * }} args `roomIndex` is 1-based; seats without a room are left in the main
 *   room; a `guest` seat is assigned by message only (never seated)
 */
export async function startBreakout({
  channelName,
  roomCount,
  seats,
  durationMinutes,
  autoAssign = true
}) {
  const pointer = getActiveCallPointer();
  const user = getActiveCallUser();
  if (!pointer || !user || session) return;
  busy = true;
  /** @type {BreakoutRoom[]} */
  const rooms = [];
  const relayConn = pool.relay(pointer.relay);
  try {
    const lk = await loadConnection();
    for (const leftover of await listRelayRooms(pointer).catch(() => [])) {
      await deleteBreakoutRoom(relayConn, leftover.id, user).catch((err) =>
        console.warn('leftover breakout room not deleted:', leftover.id, err)
      );
    }
    const until =
      durationMinutes && durationMinutes > 0
        ? Math.floor(Date.now() / 1000) + Math.round(durationMinutes * 60)
        : null;
    for (let index = 1; index <= roomCount; index++) {
      const id = generateGroupId();
      await createBreakoutRoom(
        relayConn,
        { id, parentId: pointer.id, channelName, index, until },
        user
      );
      rooms.push({ id, relay: pointer.relay, name: breakoutRoomName(index, channelName), index });
    }
    /** @type {Array<{id: string, relay: string, name: string, members: string[]}>} */
    const assignments = [];
    for (const room of rooms) {
      const mine = seats.filter((seat) => seat.roomIndex === room.index);
      for (const pubkey of unique(mine.filter((seat) => !seat.guest).map((seat) => seat.pubkey))) {
        await seatInRoom(relayConn, room.id, pubkey, user);
      }
      assignments.push({ ...room, members: mine.map((seat) => seat.identity) });
    }
    session = {
      main: { id: pointer.id, relay: pointer.relay, title: getGroupCallState().title },
      rooms,
      until,
      hosting: true,
      creator: true,
      autoAssign,
      channelName
    };
    await lk.sendBreakoutMessage(buildBreakoutAssignPayload({ rooms: assignments, until }));
  } catch (err) {
    // Leave nothing half-built behind.
    for (const room of rooms) await deleteBreakoutRoom(relayConn, room.id, user).catch(() => {});
    session = null;
    throw err;
  } finally {
    busy = false;
  }
}

/**
 * Move someone (hosting clients): seat them in the target room FIRST, then
 * take them out of their current room, so a client that sees itself vanish
 * from its roster already finds itself in the next one. `toRoomId` null =
 * back to the main room. A seat still in the main room is told directly (a
 * targeted assignment) besides being seated.
 *
 * A GUEST (`guest: true`) is on no roster: one still in the main room is
 * told by a targeted assignment only; one in a room is taken out of it
 * with the moderation endpoint's `remove` on that room (the identity it
 * announced on entering) — its client returns to the main room on its own,
 * where this client answers its new seat with the next assignment (a
 * move) or leaves it be (back to the main room).
 * @param {{pubkey: string, identities?: string[], toRoomId: string | null, guest?: boolean}} args
 */
export async function moveParticipant({ pubkey, identities = [], toRoomId, guest = false }) {
  const s = session;
  const user = getActiveCallUser();
  if (!s?.hosting || !user) return;
  if (guest) {
    await moveGuest({ pubkey, identities, toRoomId, session: s, user });
    return;
  }
  const relayConn = pool.relay(s.main.relay);
  const from = roomOfPubkey(
    s.rooms.filter((room) => !goneRoomIds.has(room.id)),
    membersByRoomId,
    pubkey
  );
  if (from?.id === toRoomId) return;
  const to = toRoomId ? s.rooms.find((room) => room.id === toRoomId) : null;
  if (toRoomId && !to) return;
  busy = true;
  try {
    if (to) await seatInRoom(relayConn, to.id, pubkey, user);
    if (from) await unseatFromRoom(relayConn, from.id, pubkey, user);
    if (!to) sentHome.set(pubkey, Date.now());
    if (to && !from && identities.length > 0 && lkModule) {
      await lkModule.sendBreakoutMessage(
        buildBreakoutAssignPayload({ rooms: [{ ...to, members: identities }], until: s.until }),
        identities
      );
    }
  } catch (err) {
    // The panel fires this and forgets (`void moveParticipant(...)`): a
    // relay refusal must reach the host as a toast, not as an unhandled
    // rejection — same as moveGuest.
    console.warn('participant not moved:', err);
    showToast(
      m.groups_call_breakout_move_failed({
        reason: err instanceof Error ? err.message : String(err)
      }),
      'error'
    );
  } finally {
    busy = false;
  }
}

/**
 * @param {{
 *   pubkey: string,
 *   identities: string[],
 *   toRoomId: string | null,
 *   session: BreakoutSession,
 *   user: {pubkey: string, signer: any}
 * }} args
 */
async function moveGuest({ pubkey, identities, toRoomId, session: s, user }) {
  const live = s.rooms.filter((room) => !goneRoomIds.has(room.id));
  const to = toRoomId ? live.find((room) => room.id === toRoomId) : null;
  if (toRoomId && !to) return;
  const seat = guestSeats[pubkey];
  const from = seat ? live.find((room) => room.id === seat.roomId) : null;
  if (from?.id === toRoomId) return;
  busy = true;
  try {
    if (from && seat) {
      await moderateCall({ id: from.id, relay: s.main.relay }, user, {
        action: 'remove',
        identity: seat.identity
      });
      forgetGuestSeat(pubkey);
      const pending = guestMoves.get(pubkey);
      if (pending) clearTimeout(pending.timer);
      guestMoves.delete(pubkey);
      if (to) {
        const timer = setTimeout(() => {
          if (guestMoves.get(pubkey)?.timer !== timer) return;
          guestMoves.delete(pubkey);
          showToast(m.groups_call_breakout_guest_move_timeout(), 'error');
        }, BREAKOUT_GUEST_MOVE_TIMEOUT_MS);
        guestMoves.set(pubkey, { toRoomId: to.id, timer });
      } else {
        sentHome.set(pubkey, Date.now());
      }
    } else if (to && identities.length > 0 && lkModule) {
      await lkModule.sendBreakoutMessage(
        buildBreakoutAssignPayload({ rooms: [{ ...to, members: identities }], until: s.until }),
        identities
      );
    }
  } catch (err) {
    console.warn('guest not moved:', err);
    showToast(
      m.groups_call_breakout_guest_move_failed({
        reason: err instanceof Error ? err.message : String(err)
      }),
      'error'
    );
  } finally {
    busy = false;
  }
}

/**
 * "+5 Min": move the deadline (a 9002 per room with the new `until`; the
 * relay lets the parent's host / co-hosts and the creator do that), tell
 * the main room, keep counting. Without a deadline, one starts now.
 * @param {number} [minutes]
 */
export async function extendBreakout(minutes = BREAKOUT_EXTEND_MINUTES) {
  const s = session;
  if (!s || minutes <= 0) return;
  const now = Math.floor(Date.now() / 1000);
  await applyDeadline(Math.max(s.until ?? now, now) + Math.round(minutes * 60), 'extend');
}

/**
 * Set the deadline from now ("In 10 Min beenden" on a session without one),
 * or take it away (`null`: `["until",""]` clears it on the relay; the
 * countdown stops everywhere). The same per-room 9002 and state replay as
 * `extendBreakout`.
 * @param {number | null} minutesFromNow
 */
export async function setBreakoutDeadline(minutesFromNow) {
  if (minutesFromNow !== null && !(minutesFromNow > 0)) return;
  const until =
    minutesFromNow === null
      ? null
      : Math.floor(Date.now() / 1000) + Math.round(minutesFromNow * 60);
  await applyDeadline(until, 'set');
}

/**
 * The deadline edit itself: every standing room gets the 9002, the session
 * follows (a NEW deadline arms the auto-return again), the main room hears
 * the state. A refusal keeps the old deadline and toasts the relay's reason.
 * @param {number | null} until unix seconds, null = no deadline
 * @param {'extend' | 'set'} what which failure text to use
 */
async function applyDeadline(until, what) {
  const s = session;
  const user = getActiveCallUser();
  if (!s?.hosting || !user) return;
  const relayConn = pool.relay(s.main.relay);
  busy = true;
  try {
    for (const room of s.rooms) {
      if (goneRoomIds.has(room.id)) continue;
      await editBreakoutUntil(
        relayConn,
        { id: room.id, parentId: s.main.id, channelName: s.channelName, index: room.index },
        until,
        user
      );
    }
    if (session && session.main.id === s.main.id) {
      session = { ...session, until };
      deadlineHandled = false;
    }
    const rooms = s.rooms.filter((room) => !goneRoomIds.has(room.id));
    await lkModule
      ?.sendBreakoutMessage(buildBreakoutStatePayload({ rooms, until }))
      .catch(() => {});
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    showToast(
      what === 'extend'
        ? m.groups_call_breakout_extend_failed({ reason })
        : m.groups_call_breakout_deadline_failed({ reason }),
      'error'
    );
  } finally {
    busy = false;
  }
}

/** A pubkey's display name from the profiles already loaded, else its prefix. @param {string} pubkey */
function nameOfPubkey(pubkey) {
  let profile;
  try {
    const event = eventStore.getReplaceable(0, pubkey);
    profile = event ? getProfileContent(event) : undefined;
  } catch {
    profile = undefined;
  }
  return getUserDisplayName(pubkey, profile);
}

/**
 * Show a broadcast once: `message` and `return` as a toast naming the
 * sender plus a system line in the call chat (so people who missed the
 * toast still see it); `countdown` only moves the deadline (no toast — one
 * comes every few minutes).
 * @param {import('./call-broadcasts.js').CallBroadcast} broadcast
 */
function renderBroadcast(broadcast) {
  const s = session;
  if (!s || broadcast.parentId !== s.main.id) return;
  const key = broadcast.id ?? `${broadcast.pubkey}:${broadcast.createdAt}:${broadcast.type}`;
  if (seenBroadcasts.has(key)) return;
  seenBroadcasts.add(key);
  if (broadcast.type === 'countdown') {
    const seconds = broadcast.seconds ?? 0;
    const until = Math.floor(Date.now() / 1000) + seconds;
    // Our own clock already agrees within a tick or two: leave it alone.
    if (s.until !== null && Math.abs(s.until - until) <= 2) return;
    if ((s.until ?? 0) < until) deadlineHandled = false;
    session = { ...s, until };
    return;
  }
  const text =
    broadcast.type === 'return'
      ? broadcast.content.trim() || m.groups_call_broadcast_return_default()
      : broadcast.content.trim();
  if (!text) return;
  const name = nameOfPubkey(broadcast.pubkey);
  showToast(m.groups_call_broadcast_toast({ name, text }), 'info');
  lkModule?.addSystemCallChat?.({ identity: `${broadcast.pubkey}:relay`, text, id: key });
}

/**
 * Publish a call broadcast to the parent group (the relay accepts it from
 * the parent's current call host / co-hosts or an admin and never stores
 * it). The sender's own client renders it right away; the relay's echo is
 * deduped by id. A refusal (an old relay, no rights) is toasted with the
 * relay's reason unless `quiet`.
 * @param {import('./call-broadcasts.js').CallBroadcastType} type
 * @param {string} [content]
 * @param {{quiet?: boolean}} [opts]
 * @returns {Promise<boolean>} whether the relay took it
 */
export async function sendCallBroadcast(type, content = '', opts = {}) {
  const s = session;
  const user = getActiveCallUser();
  if (!s?.hosting || !user) return false;
  try {
    const signed = await publishToGroupRelay(
      pool.relay(s.main.relay),
      buildCallBroadcastTemplate(s.main.id, type, content),
      user
    );
    const parsed = parseCallBroadcast(signed);
    if (parsed) renderBroadcast(parsed);
    return true;
  } catch (err) {
    console.warn('call broadcast not sent:', err);
    if (!opts.quiet) {
      showToast(
        m.groups_call_breakout_broadcast_failed({
          reason: err instanceof Error ? err.message : String(err)
        }),
        'error'
      );
    }
    return false;
  }
}

/**
 * The host panel's "Nachzügler automatisch verteilen" switch mid-session;
 * remembered on this device like the dialog's.
 * @param {boolean} enabled
 */
export function setSessionAutoAssign(enabled) {
  if (!session?.hosting) return;
  session = { ...session, autoAssign: enabled };
  setBreakoutAutoAssign(enabled);
}

/**
 * "Alle zurückholen" / the host ends the session: delete every room (the
 * clients in them see the 9008 and return), tell the main room, forget.
 * `notify`: send the `return` broadcast first ("Bitte zurück in den
 * Hauptraum"), so the rooms hear why they are being pulled.
 * @param {{notify?: boolean}} [opts]
 */
export async function endBreakout(opts = {}) {
  const s = session;
  const user = getActiveCallUser();
  if (!s?.hosting || !user) return;
  busy = true;
  if (opts.notify) {
    await sendCallBroadcast('return', m.groups_call_broadcast_return_default(), { quiet: true });
  }
  const relayConn = pool.relay(s.main.relay);
  /** @type {string[]} */
  const failed = [];
  try {
    for (const room of s.rooms) {
      if (goneRoomIds.has(room.id)) continue;
      try {
        await deleteBreakoutRoom(relayConn, room.id, user);
      } catch (err) {
        console.warn('breakout room not deleted:', room.id, err);
        failed.push(room.name);
      }
    }
    if (lkModule) await lkModule.sendBreakoutMessage(buildBreakoutEndPayload()).catch(() => {});
  } finally {
    busy = false;
  }
  if (currentRoom) await returnToMain();
  clearSession();
  if (failed.length > 0) {
    showToast(m.groups_call_breakout_end_partial({ rooms: failed.join(', ') }), 'error');
  }
}

/** @param {string} roomId */
function markGone(roomId) {
  if (goneRoomIds.has(roomId)) return;
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw Set, replaced wholesale
  const next = new Set(goneRoomIds);
  next.add(roomId);
  goneRoomIds = next;
}

async function onDeadline() {
  if (deadlineHandled) return;
  deadlineHandled = true;
  const s = session;
  if (!s) return;
  // Whoever runs the session from the main room deletes the rooms: the
  // creator (its admin on any relay), or the host seat (the extension's
  // rule). Everyone else just goes home — the relay sweeps the rest.
  if (s.hosting && !currentRoom && (s.creator || holdsHostSeat())) {
    await endBreakout();
    return;
  }
  if (currentRoom) await returnToMain();
  clearSession();
}

// ─── Watch: listener, leaving, following the relay, the deadline ───
// Module-level root effect (never torn down): the session outlives every
// view, exactly like the call itself.
if (typeof window !== 'undefined') {
  $effect.root(() => {
    // The connection service is loaded on the first live call (never
    // statically — see group-call.svelte.js), and the breakout listener
    // registered with it.
    $effect(() => {
      if (getGroupCallState().phase === 'ready') void loadConnection();
    });

    // Leaving the call altogether forgets the session. A switch passes
    // through idle too — ignored while `switching`.
    $effect(() => {
      const phase = getGroupCallState().phase;
      if (phase !== 'idle') return;
      discoveredFor = null;
      if (untrack(() => switching)) return;
      if (session || currentRoom || pending) clearSession();
    });

    // A late joiner: once live in a call without a known session, ask the
    // relay for the channel's ephemeral rooms (once per call).
    $effect(() => {
      const phase = getGroupCallState().phase;
      const s = session;
      if (phase !== 'ready' || s || currentRoom || untrack(() => switching)) return;
      const pointer = getActiveCallPointer();
      if (!pointer) return;
      const key = `${normalizeURL(pointer.relay)}'${pointer.id}`;
      if (discoveredFor === key) return;
      discoveredFor = key;
      void discoverSession(pointer);
    });

    // The relay hands this seat the host role while a session runs that
    // this client does not manage yet (the host left; this co-host was
    // next): take over — panel, newcomers, the deadline.
    let heldSeat = false;
    $effect(() => {
      const s = session;
      const inRoom = currentRoom;
      const seat = holdsHostSeat();
      const gained = seat && !heldSeat;
      heldSeat = seat;
      if (!s || inRoom || !seat || s.hosting) return;
      session = {
        ...s,
        hosting: true,
        creator: false,
        autoAssign: getBreakoutAutoAssign() ?? true,
        channelName: s.channelName || channelNameOf(s.rooms)
      };
      if (gained) showToast(m.groups_call_breakout_took_over(), 'info');
    });

    // The server ended our seat in a BREAKOUT room — the relay deleted the
    // room (DisconnectReason ROOM_DELETED after its DeleteRoom) or the host
    // took us out of it: that means "back to the main room", never the
    // "call ended" screen.
    $effect(() => {
      const room = currentRoom;
      if (!room || !lkReady || !lkModule) return;
      if (getGroupCallState().phase !== 'ended') return;
      const reason = lkModule.getLiveKitState().disconnectReason;
      if (!lkModule.isRemovalReason(reason)) return;
      if (lkModule.isRoomDeletedReason(reason)) {
        markGone(room.id);
        showToast(m.groups_call_breakout_room_closed(), 'info');
      } else {
        // Taken out of the room by the host — for a guest that is how a
        // move works (the next assignment follows in the main room).
        void returnToMain();
        showToast(m.groups_call_breakout_moved_out(), 'info');
      }
    });

    // Whose kind 39000/39002/39004 to believe: the relay's own key (NIP-11).
    /** @type {string[]} */
    let authors = $state.raw([]);
    let ready = $state(false);
    // Keyed on the relay URL alone: a reassigned session (a moved deadline)
    // must not re-race the key and flap the subscription below.
    const mainRelay = $derived(session?.main.relay ?? null);
    $effect(() => {
      const relay = mainRelay;
      authors = [];
      ready = false;
      if (!relay) return;
      return raceRelayKey(normalizeURL(relay), {
        onAuthors: (resolved) => {
          authors = resolved;
        },
        onReady: () => {
          ready = true;
        }
      });
    });

    // Follow the rooms while a session is known: in a room (to find the way
    // back or on), hosting (to move people), or waiting in the main room
    // (to see rooms close and the deadline move). Keyed on the room ids and
    // the relay only — a moved deadline must not re-open the subscription.
    const followKey = $derived(
      session
        ? `${normalizeURL(session.main.relay)} ${session.main.id} ${session.rooms.map((r) => r.id).join(' ')}`
        : ''
    );
    $effect(() => {
      const key = followKey;
      const isReady = ready;
      const pinned = authors;
      if (!key || !isReady) return;
      const [relay, mainId, ...ids] = key.split(' ');
      const sub = pool
        .relay(relay)
        .subscription([
          { kinds: [GROUP_METADATA_KIND, GROUP_MEMBERS_KIND, CALL_PRESENCE_KIND], '#d': ids },
          { kinds: [DELETE_GROUP_KIND], '#h': ids },
          // The main room too: who is in it (a host in a room must know), and
          // its roster (a main-room seat not on it is a guest).
          { kinds: [GROUP_MEMBERS_KIND, CALL_PRESENCE_KIND], '#d': [mainId] }
        ])
        .subscribe({
          next: (/** @type {any} */ event) => {
            if (event === 'EOSE') {
              rostersAnswered = true;
              return;
            }
            if (!event || typeof event !== 'object') return;
            if (event.kind === DELETE_GROUP_KIND) {
              const h = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'h')?.[1];
              if (h && ids.includes(h)) markGone(h);
              return;
            }
            if (!isTrustedSigner(event, pinned)) return;
            const d = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
            if (!d || (d !== mainId && !ids.includes(d))) return;
            const seenKey = `${event.kind}:${d}`;
            if (
              typeof event.created_at !== 'number' ||
              event.created_at < (newestSeen[seenKey] ?? 0)
            ) {
              return;
            }
            newestSeen[seenKey] = event.created_at;
            if (d === mainId) {
              if (event.kind === CALL_PRESENCE_KIND) mainPresence = parseCallParticipants(event);
              else if (event.kind === GROUP_MEMBERS_KIND)
                mainMembers = new Set(getGroupMembers(event) ?? []);
              return;
            }
            if (event.kind === GROUP_MEMBERS_KIND) {
              membersByRoomId = {
                ...membersByRoomId,
                [d]: new Set(getGroupMembers(event) ?? [])
              };
            } else if (event.kind === CALL_PRESENCE_KIND) {
              presenceByRoomId = { ...presenceByRoomId, [d]: parseCallParticipants(event) };
            } else if (event.kind === GROUP_METADATA_KIND) {
              if (channelDeleted(event)) {
                markGone(d);
                return;
              }
              // The deadline lives on the room (`until`): a host moved it.
              // A newer 39000 without `until` means the host took the
              // deadline away (`["until",""]`): the countdown stops here too.
              const marker = parseBreakoutMarker(event);
              if (marker && session && marker.until !== session.until) {
                if ((session.until ?? 0) < (marker.until ?? 0)) deadlineHandled = false;
                session = { ...session, until: marker.until };
              }
            }
          },
          error: () => {
            rostersAnswered = true;
          }
        });
      return () => sub.unsubscribe();
    });

    // Call broadcasts (kind 20002) for the session's parent, while a
    // session is known — in the main room or in a room. Ephemeral: the
    // relay sends only what arrives from now on.
    const broadcastKey = $derived(
      session ? `${normalizeURL(session.main.relay)} ${session.main.id}` : ''
    );
    $effect(() => {
      const key = broadcastKey;
      if (!key) return;
      const [relay, mainId] = key.split(' ');
      const sub = pool
        .relay(relay)
        .subscription([callBroadcastFilter(mainId)])
        .subscribe({
          next: (/** @type {any} */ event) => {
            if (!event || typeof event !== 'object') return;
            const broadcast = parseCallBroadcast(event);
            if (broadcast) renderBroadcast(broadcast);
          },
          error: () => {}
        });
      return () => sub.unsubscribe();
    });

    // In the main room, not hosting: a room roster that names me IS my
    // assignment (the host seated me through the relay — from a breakout
    // room, where the data channel cannot reach me). The answer to my own
    // knock switches at once; otherwise I am asked, once per room (a
    // decline holds until a roster moves me elsewhere). Guests are on no
    // roster.
    $effect(() => {
      const s = session;
      const me = getActiveCallUser()?.pubkey;
      if (!s || currentRoom || s.hosting || !me || untrack(() => switching)) return;
      if (seatIsGuest()) return;
      const rooms = s.rooms.filter((room) => !goneRoomIds.has(room.id));
      const mine = roomOfPubkey(rooms, membersByRoomId, me);
      if (!mine) {
        rosterOfferedRoomId = null;
        return;
      }
      if (joinRequest?.roomId === mine.id) {
        clearTimeout(joinTimer);
        joinRequest = null;
        rosterOfferedRoomId = mine.id;
        void enterRoom(mine);
        return;
      }
      if (rosterOfferedRoomId === mine.id) return;
      rosterOfferedRoomId = mine.id;
      if (untrack(() => pending)?.room.id === mine.id) return;
      offerAssignment(mine);
    });

    // Hosting, in a room: whoever arrives in the main room (its 39004) is
    // dealt with from here — in the main room the LiveKit newcomer path
    // (onNewcomer) does that, with the data channel at hand. A seat that
    // left the main room is forgotten, so a return counts as an arrival.
    $effect(() => {
      const s = session;
      const here = mainPresence;
      const members = mainMembers;
      const room = currentRoom;
      const user = getActiveCallUser();
      if (!s?.hosting || !user) return;
      const present = new Set(here);
      for (const pubkey of [...arrivedInMain])
        if (!present.has(pubkey)) arrivedInMain.delete(pubkey);
      if (!room) return;
      for (const pubkey of here) {
        if (pubkey === user.pubkey || arrivedInMain.has(pubkey)) continue;
        arrivedInMain.add(pubkey);
        if (!members.has(pubkey)) continue;
        void seatArrivalFromRoom(pubkey, s, user);
      }
    });

    // React, in a room: the room is gone → main; I am not in its roster →
    // another room that names me, else (after the move grace) main. A
    // guest is on no roster: for it only the room's end (above, 9008, the
    // tombstone, the deadline) and the host's `remove` count.
    $effect(() => {
      const room = currentRoom;
      const s = session;
      if (!room || !s) return;
      if (goneRoomIds.has(room.id)) {
        void returnToMain();
        return;
      }
      if (seatIsGuest()) return;
      if (!rostersAnswered) return;
      const me = getActiveCallUser()?.pubkey;
      const members = membersByRoomId[room.id];
      if (!me || !members) return;
      if (members.has(me)) {
        clearTimeout(returnTimer);
        return;
      }
      const elsewhere = roomOfPubkey(
        s.rooms.filter((r) => r.id !== room.id && !goneRoomIds.has(r.id)),
        membersByRoomId,
        me
      );
      if (elsewhere) {
        void enterRoom(elsewhere);
        return;
      }
      clearTimeout(returnTimer);
      returnTimer = setTimeout(() => void returnToMain(), BREAKOUT_MOVE_GRACE_MS);
    });

    // In the main room: every room gone (the host ended it elsewhere, the
    // relay swept them) → nothing left to host or to join.
    $effect(() => {
      const s = session;
      if (!s || currentRoom) return;
      if (s.rooms.length > 0 && s.rooms.every((room) => goneRoomIds.has(room.id))) clearSession();
    });

    // The deadline: a one-second tick while there is one.
    $effect(() => {
      const until = session?.until ?? null;
      if (until === null) {
        remaining = null;
        return;
      }
      const tick = () => {
        // Work on a local: reading `remaining` back here would make it a
        // dependency of this effect, which the interval then re-triggers
        // every second (tearing the interval down and up each tick).
        const left = remainingSeconds(until, Date.now());
        remaining = left;
        if (left === 0) {
          void onDeadline();
          return;
        }
        // The host seat warns the rooms at 300 / 120 / 60 s (a moved
        // deadline fires them again — countdownDue forgets marks above it).
        if (left !== null && session?.hosting && !currentRoom && holdsHostSeat()) {
          const { mark, sent } = countdownDue(left, countdownSent);
          countdownSent = sent;
          if (mark !== null) void sendCallBroadcast('countdown', String(left), { quiet: true });
        }
      };
      tick();
      const timer = setInterval(tick, 1000);
      return () => clearInterval(timer);
    });
  });
}

/** Tests only: forget everything, including the loaded connection module. */
export function __resetBreakout() {
  switching = false;
  discoveredFor = null;
  clearSession();
  pending = null;
}

/** Tests only: the pending guest moves this client waits to complete. */
export function __pendingGuestMoves() {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a snapshot for assertions
  return new Map([...guestMoves].map(([pubkey, move]) => [pubkey, move.toRoomId]));
}
