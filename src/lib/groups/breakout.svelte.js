// Breakout rooms — the one breakout session this client knows about.
//
// Client-only, ephemeral (issue "Video-Call Feature: Breakout Rooms", option
// A): a host or co-host of a channel call creates one hidden NIP-29 AV
// sub-group per room on the channel's relay (breakout-relay.js), seats the
// assigned people with put-user and tells the seats in the main room where
// to go with a LiveKit data message on `edufeed.call.breakout`
// (breakout.js). A client that finds its own seat in a room is asked (or
// auto-switches after a few seconds) and moves its live call there without
// the lobby, mic and camera as they were (group-call.svelte.js
// `switchGroupCall`).
//
// While in a room a client FOLLOWS the relay, not the host's data messages
// (the SFU of the main room no longer reaches it):
//   (a) its own membership of the room (kind 39002): gone → back to the main
//       room — after a short grace, because a MOVE is remove-user + put-user
//       and (b) another room's roster naming it means "go there instead";
//   (c) the room's kind 39000 tombstone or a kind 9008: the host ended the
//       session → back to the main room;
//   (d) the deadline from the room marker / assignment: countdown in the
//       header, back to the main room at zero (the host, if present, deletes
//       the rooms then).
// The host sees the same rosters (plus kind 39004 presence) in the breakout
// panel to move people and to bring everyone back (= delete every room).
//
// The host keeps host rights only in the main room: the relay seats whoever
// opens a room's call as that room's host. Only the creator of the rooms
// (their NIP-29 admin) can move people or delete them; a co-host who did
// not start the session can only start one of their own once this one ends.
import { normalizeURL } from 'applesauce-core/helpers/url';
import {
  GROUP_METADATA_KIND,
  GROUP_MEMBERS_KIND,
  DELETE_GROUP_KIND,
  getGroupMembers
} from 'applesauce-common/helpers/groups';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { modalStore } from '$lib/stores/modal.svelte.js';
import { showToast } from '$lib/helpers/toast';
import { unique } from '$lib/helpers/unique.js';
import * as m from '$lib/paraglide/messages';
import { generateGroupId } from './group-management.js';
import {
  getGroupCallState,
  getActiveCallPointer,
  getActiveCallUser,
  switchGroupCall
} from './group-call.svelte.js';
import {
  createBreakoutRoom,
  seatInRoom,
  unseatFromRoom,
  deleteBreakoutRoom
} from './breakout-relay.js';
import { raceRelayKey } from './relay-key-race.js';
import { isTrustedSigner } from './relay-directory.js';
import { CALL_PRESENCE_KIND, parseCallParticipants } from './call-presence.js';
import { channelDeleted } from './channel-access.js';
import { participantCallRole } from './livekit.js';
import {
  BREAKOUT_AUTO_SWITCH_MS,
  assignedRoom,
  breakoutRoomName,
  buildBreakoutAssignPayload,
  buildBreakoutEndPayload,
  parseBreakoutPayload,
  remainingSeconds,
  roomOfPubkey
} from './breakout.js';

/** How long a seat that vanished from its room waits for a put-user elsewhere. */
export const BREAKOUT_MOVE_GRACE_MS = 2500;

/**
 * @typedef {{id: string, relay: string, name: string, index: number}} BreakoutRoom
 * @typedef {{
 *   main: {id: string, relay: string, title: string},
 *   rooms: BreakoutRoom[],
 *   until: number | null,
 *   hosting: boolean
 * }} BreakoutSession
 */

/** @type {BreakoutSession | null} */
let session = $state.raw(null);
/** @type {BreakoutRoom | null} the room this client's call is in */
let currentRoom = $state.raw(null);
/** @type {Record<string, Set<string>>} room id -> pubkeys (kind 39002) */
let membersByRoomId = $state.raw({});
/** @type {Record<string, string[]>} room id -> pubkeys live in the call (kind 39004) */
let presenceByRoomId = $state.raw({});
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

// Plain lets: bookkeeping, never rendered.
/** @type {typeof import('$lib/services/livekit-connection.svelte.js') | null} */
let lkModule = null;
/** @type {Promise<typeof import('$lib/services/livekit-connection.svelte.js')> | null} */
let lkLoading = null;
/** @type {(() => void) | null} */
let stopListener = null;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let returnTimer;
// A switch leaves one call before joining the next: the store must not read
// that idle moment as "the user left the call".
let switching = false;
let deadlineHandled = false;
/** @type {Record<string, number>} newest created_at seen per room id and kind */
let newestSeen = {};

/**
 * @returns {{
 *   session: BreakoutSession | null,
 *   currentRoom: BreakoutRoom | null,
 *   rooms: BreakoutRoom[],
 *   membersByRoomId: Record<string, Set<string>>,
 *   presenceByRoomId: Record<string, string[]>,
 *   remaining: number | null,
 *   busy: boolean,
 *   pending: {room: BreakoutRoom} | null
 * }}
 */
export function getBreakoutState() {
  return {
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
    get remaining() {
      return remaining;
    },
    get busy() {
      return busy;
    },
    get pending() {
      return pending;
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
    return lk;
  });
  return lkLoading;
}

function clearSession() {
  clearTimeout(returnTimer);
  session = null;
  currentRoom = null;
  membersByRoomId = {};
  presenceByRoomId = {};
  goneRoomIds = new Set();
  rostersAnswered = false;
  remaining = null;
  deadlineHandled = false;
  newestSeen = {};
  if (pending) {
    pending = null;
    if (modalStore.activeModal === 'breakoutAssignment') modalStore.closeModal();
  }
}

/**
 * A data message on the breakout topic from someone in the main room.
 * Assignments are believed only from a seat the relay marked host or
 * co-host (participant metadata — not forgeable by a client).
 * @param {unknown} raw
 * @param {{identity: string, metadata?: string}} sender
 */
function handleMessage(raw, sender) {
  const payload = parseBreakoutPayload(raw);
  if (!payload) return;
  if (payload.t === 'end') {
    if (!session?.hosting) clearSession();
    return;
  }
  if (!participantCallRole(sender)) return;
  const pointer = getActiveCallPointer();
  if (!pointer || currentRoom) return;
  const rooms = payload.rooms.map((room, i) => ({
    id: room.id,
    relay: room.relay,
    name: room.name,
    index: i + 1
  }));
  if (!session?.hosting) {
    // A targeted assignment (a later move from the main room) carries only
    // its one room; keep the rooms already known.
    const known = session?.rooms ?? [];
    const merged = [...known.filter((r) => !rooms.some((n) => n.id === r.id)), ...rooms].sort(
      (a, b) => a.index - b.index
    );
    session = {
      main: { id: pointer.id, relay: pointer.relay, title: getGroupCallState().title },
      rooms: merged,
      until: payload.until ?? session?.until ?? null,
      hosting: false
    };
  }
  const myIdentity = lkModule?.getLiveKitState().localParticipant?.identity;
  const mine = myIdentity ? assignedRoom(payload, myIdentity) : null;
  if (!mine) return;
  const room = session.rooms.find((r) => r.id === mine.id);
  if (room) offerAssignment(room);
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

/** @param {BreakoutRoom} room */
async function enterRoom(room) {
  clearTimeout(returnTimer);
  switching = true;
  currentRoom = room;
  try {
    await switchGroupCall({ id: room.id, relay: room.relay }, { title: room.name });
  } finally {
    switching = false;
  }
  if (getGroupCallState().phase === 'error') {
    showToast(m.groups_call_breakout_switch_failed(), 'error');
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
  switching = true;
  try {
    await switchGroupCall({ id: s.main.id, relay: s.main.relay }, { title: s.main.title });
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
 * Create the rooms, seat everyone and send the assignment.
 * @param {{
 *   channelName: string,
 *   roomCount: number,
 *   seats: Array<{identity: string, pubkey: string, roomIndex: number}>,
 *   durationMinutes?: number | null
 * }} args `roomIndex` is 1-based; seats without a room are left in the main room
 */
export async function startBreakout({ channelName, roomCount, seats, durationMinutes }) {
  const pointer = getActiveCallPointer();
  const user = getActiveCallUser();
  if (!pointer || !user || session) return;
  busy = true;
  /** @type {BreakoutRoom[]} */
  const rooms = [];
  const relayConn = pool.relay(pointer.relay);
  try {
    const lk = await loadConnection();
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
      for (const pubkey of unique(mine.map((seat) => seat.pubkey))) {
        await seatInRoom(relayConn, room.id, pubkey, user);
      }
      assignments.push({ ...room, members: mine.map((seat) => seat.identity) });
    }
    session = {
      main: { id: pointer.id, relay: pointer.relay, title: getGroupCallState().title },
      rooms,
      until,
      hosting: true
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
 * Move someone (host only): seat them in the target room FIRST, then take
 * them out of their current room, so a client that sees itself vanish from
 * its roster already finds itself in the next one. `toRoomId` null = back to
 * the main room. A seat still in the main room is told directly (a targeted
 * assignment) besides being seated.
 * @param {{pubkey: string, identities?: string[], toRoomId: string | null}} args
 */
export async function moveParticipant({ pubkey, identities = [], toRoomId }) {
  const s = session;
  const user = getActiveCallUser();
  if (!s?.hosting || !user) return;
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
    if (to && !from && identities.length > 0 && lkModule) {
      await lkModule.sendBreakoutMessage(
        buildBreakoutAssignPayload({ rooms: [{ ...to, members: identities }], until: s.until }),
        identities
      );
    }
  } finally {
    busy = false;
  }
}

/**
 * "Alle zurückholen" / the host ends the session: delete every room (the
 * clients in them see the 9008 and return), tell the main room, forget.
 */
export async function endBreakout() {
  const s = session;
  const user = getActiveCallUser();
  if (!s?.hosting || !user) return;
  busy = true;
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
  if (s.hosting) {
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
      if (switching) return;
      if (session || currentRoom || pending) clearSession();
    });

    // Whose kind 39000/39002/39004 to believe: the relay's own key (NIP-11).
    /** @type {string[]} */
    let authors = $state.raw([]);
    let ready = $state(false);
    $effect(() => {
      const relay = session?.main.relay;
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

    // Follow the rooms while this client is in one, or hosts the session.
    $effect(() => {
      const s = session;
      const inRoom = currentRoom;
      const isReady = ready;
      const pinned = authors;
      if (!s || (!inRoom && !s.hosting) || !isReady) return;
      const ids = s.rooms.map((room) => room.id);
      const relay = normalizeURL(s.main.relay);
      const sub = pool
        .relay(relay)
        .subscription([
          { kinds: [GROUP_METADATA_KIND, GROUP_MEMBERS_KIND, CALL_PRESENCE_KIND], '#d': ids },
          { kinds: [DELETE_GROUP_KIND], '#h': ids }
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
            if (!d || !ids.includes(d)) return;
            const seenKey = `${event.kind}:${d}`;
            if (
              typeof event.created_at !== 'number' ||
              event.created_at < (newestSeen[seenKey] ?? 0)
            ) {
              return;
            }
            newestSeen[seenKey] = event.created_at;
            if (event.kind === GROUP_MEMBERS_KIND) {
              membersByRoomId = {
                ...membersByRoomId,
                [d]: new Set(getGroupMembers(event) ?? [])
              };
            } else if (event.kind === CALL_PRESENCE_KIND) {
              presenceByRoomId = { ...presenceByRoomId, [d]: parseCallParticipants(event) };
            } else if (event.kind === GROUP_METADATA_KIND && channelDeleted(event)) {
              markGone(d);
            }
          },
          error: () => {
            rostersAnswered = true;
          }
        });
      return () => sub.unsubscribe();
    });

    // React, in a room: the room is gone → main; I am not in its roster →
    // another room that names me, else (after the move grace) main.
    $effect(() => {
      const room = currentRoom;
      const s = session;
      if (!room || !s) return;
      if (goneRoomIds.has(room.id)) {
        void returnToMain();
        return;
      }
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

    // Hosting from the main room: every room gone (ended elsewhere, e.g. in
    // the pop-out or another device) → nothing left to host.
    $effect(() => {
      const s = session;
      if (!s?.hosting || currentRoom) return;
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
        remaining = remainingSeconds(until, Date.now());
        if (remaining === 0) void onDeadline();
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
  clearSession();
  pending = null;
}
