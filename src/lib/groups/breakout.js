// Breakout rooms — the pure half (no network, no Svelte).
//
// A breakout room is an ordinary, EPHEMERAL NIP-29 AV group on the channel's
// own relay: the host creates one sub-group per room (kind 9007 + 9002,
// `livekit` on), seats people with put-user (9000) and deletes the rooms
// (9008) when the session ends. Nothing survives the call. The orchestration
// lives in breakout.svelte.js; this file holds everything that can be unit
// tested without a relay or a LiveKit room: the balanced random split, the
// kind-39000 marker that keeps rooms out of every channel list, the metadata
// a room is created with, the `edufeed.call.breakout` wire format and the
// deadline math.
//
// The marker (docs/nips/nip29-ephemeral-groups.md): a room's 39000 carries
// `["ephemeral", <parent id>]` and, with a deadline, `["until", <unix>]` —
// the relay stores both, restates them on the regenerated 39000, deletes the
// group itself when its call is over and lets the parent's call host / co-
// hosts moderate it. The first implementation put the same facts into the
// free-text `about` (`edufeed:breakout parent=<id> n=<N> [until=<unix>]`)
// because pyramid dropped every tag it did not know; that marker is still
// written AND read as the transition fallback for relays without the
// extension. The tags win when both are present.
import { GROUP_METADATA_KIND } from 'applesauce-common/helpers/groups';
import { isValidRelayWebsocketUrl } from './groups.js';

/** LiveKit data-message topic for breakout assignments (never the chat's). */
export const BREAKOUT_TOPIC = 'edufeed.call.breakout';
export const BREAKOUT_MIN_ROOMS = 2;
export const BREAKOUT_MAX_ROOMS = 8;
/** How long the "you were assigned to room N" prompt waits before switching. */
export const BREAKOUT_AUTO_SWITCH_MS = 5000;
/** "+5 Min" in the host panel. */
export const BREAKOUT_EXTEND_MINUTES = 5;
const MARKER = 'edufeed:breakout';

/**
 * Deal `items` into `roomCount` rooms as evenly as possible, in a random
 * order. `rng` is injectable (tests) and must return [0, 1).
 * @template T
 * @param {T[]} items
 * @param {number} roomCount
 * @param {() => number} [rng]
 * @returns {T[][]} exactly `roomCount` arrays (possibly empty)
 */
export function splitRandom(items, roomCount, rng = Math.random) {
  if (
    !Number.isInteger(roomCount) ||
    roomCount < BREAKOUT_MIN_ROOMS ||
    roomCount > BREAKOUT_MAX_ROOMS
  ) {
    throw new RangeError(`room count must be ${BREAKOUT_MIN_ROOMS}-${BREAKOUT_MAX_ROOMS}`);
  }
  const shuffled = [...items];
  // Fisher–Yates
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  /** @type {T[][]} */
  const rooms = Array.from({ length: roomCount }, () => []);
  shuffled.forEach((item, i) => rooms[i % roomCount].push(item));
  return rooms;
}

/** @param {number} index 1-based @param {string} channelName */
export function breakoutRoomName(index, channelName) {
  return `Breakout ${index} · ${channelName}`;
}

/**
 * The machine-readable `about` of a room: which channel it belongs to, its
 * number, and (optionally) the unix-seconds deadline after which clients
 * return on their own.
 * @param {{parent: string, index: number, until?: number | null}} marker
 */
export function breakoutAbout({ parent, index, until }) {
  let about = `${MARKER} parent=${parent} n=${index}`;
  if (typeof until === 'number' && Number.isFinite(until)) about += ` until=${Math.floor(until)}`;
  return about;
}

/** @param {{tags?: string[][]} | null | undefined} event @param {string} name */
function tagValue(event, name) {
  const tag = event?.tags?.find((t) => Array.isArray(t) && t[0] === name);
  return typeof tag?.[1] === 'string' ? tag[1] : undefined;
}

/** The `about` marker's fields, or null when the text is not one. @param {string | undefined} about */
function parseAboutMarker(about) {
  if (typeof about !== 'string' || !about.startsWith(`${MARKER} `)) return null;
  /** @type {Record<string, string>} */
  const fields = {};
  for (const part of about.slice(MARKER.length + 1).split(/\s+/)) {
    const eq = part.indexOf('=');
    if (eq > 0) fields[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return fields;
}

/** @param {unknown} raw */
function parseUntil(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Which room a group is: the `ephemeral` / `until` tags of the extension,
 * else the legacy `about` marker. The room's number comes from the marker's
 * `n=` when present, else from the name this client gives rooms
 * (`Breakout N · …`), else 1.
 * @param {{kind?: number, tags?: string[][]} | null | undefined} metadataEvent a kind 39000
 * @returns {{parent: string, index: number, until: number | null} | null}
 */
export function parseBreakoutMarker(metadataEvent) {
  if (!metadataEvent || !Array.isArray(metadataEvent.tags)) return null;
  const fields = parseAboutMarker(tagValue(metadataEvent, 'about'));
  const ephemeral = tagValue(metadataEvent, 'ephemeral');
  const parent = ephemeral || fields?.parent;
  if (!parent) return null;
  const fromMarker = Number(fields?.n);
  const fromName = Number(/^Breakout (\d+)\b/.exec(tagValue(metadataEvent, 'name') ?? '')?.[1]);
  const index = Number.isInteger(fromMarker) && fromMarker >= 1 ? fromMarker : fromName || 1;
  const untilTag = tagValue(metadataEvent, 'until');
  const until = untilTag !== undefined ? parseUntil(untilTag) : parseUntil(fields?.until);
  return { parent, index, until };
}

/**
 * Whether a kind-39000 describes a breakout room — by the `ephemeral` tag
 * or the legacy `about` marker. Every channel list, the sidebar, `/groups`,
 * discovery and the community calendar drop these.
 * @param {{kind?: number, tags?: string[][]} | null | undefined} metadataEvent
 */
export function isBreakoutGroup(metadataEvent) {
  return (
    !!metadataEvent &&
    metadataEvent.kind === GROUP_METADATA_KIND &&
    parseBreakoutMarker(metadataEvent) !== null
  );
}

/**
 * The rooms a relay reports for a parent (the `#ephemeral` read of the
 * extension): one entry per live 39000 that is a breakout room of `parentId`,
 * tombstones and strangers dropped, ordered by room number.
 * @param {Array<{kind?: number, tags?: string[][]}>} events kind-39000s
 * @param {string} parentId
 * @param {string} relay
 * @returns {Array<{id: string, relay: string, name: string, index: number, until: number | null}>}
 */
export function roomsFromMetadataEvents(events, parentId, relay) {
  /** @type {Array<{id: string, relay: string, name: string, index: number, until: number | null}>} */
  const rooms = [];
  for (const event of events) {
    const id = tagValue(event, 'd');
    const name = tagValue(event, 'name') ?? '';
    const marker = isBreakoutGroup(event) ? parseBreakoutMarker(event) : null;
    if (!id || !marker || marker.parent !== parentId || name === '[deleted]') continue;
    if (rooms.some((room) => room.id === id)) continue;
    rooms.push({ id, relay, name, index: marker.index, until: marker.until });
  }
  return rooms.sort((a, b) => a.index - b.index);
}

/**
 * The metadata a room is created with (`createGroupOnRelay`): hidden from
 * listings, closed (nobody self-joins — the host seats people), PUBLIC so
 * every participant can read every room's roster (pyramid hides a private
 * group's 39002 from non-members, and following the rosters is how a client
 * learns it was moved), an AV space, and — when the host holds a role in
 * the channel — a child of it. `withParent: false` is the fallback for a
 * host who is only a member of the channel: pyramid rejects a `parent` from
 * anyone without a role in the parent (reject-event.go), and the marker
 * names the parent anyway. `ephemeral` + `until` are the extension's tags,
 * the `about` marker the fallback for a relay without it.
 * @param {{parentId: string, channelName: string, index: number, until?: number | null, withParent: boolean}} args
 */
export function breakoutRoomMetadata({ parentId, channelName, index, until, withParent }) {
  return {
    name: breakoutRoomName(index, channelName),
    about: breakoutAbout({ parent: parentId, index, until }),
    isPublic: true,
    isOpen: false,
    isHidden: true,
    livekit: true,
    ephemeral: parentId,
    until: typeof until === 'number' && Number.isFinite(until) ? Math.floor(until) : null,
    ...(withParent ? { parent: parentId } : {})
  };
}

/**
 * pyramid's answer to a 9002 whose `parent` the author has no role in.
 * @param {unknown} error
 */
export function isParentRoleRejection(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /must be an admin of the parent group/i.test(message);
}

/**
 * @typedef {{id: string, relay: string, name: string, members: string[]}} BreakoutRoomAssignment
 *   `members` are LiveKit identities (`<pubkey>:<random>`), so each SEAT is
 *   addressed — a user sitting in the call twice may be sent to two rooms.
 * @typedef {{id: string, relay: string, name: string}} BreakoutRoomRef
 * @typedef {{t: 'assign', rooms: BreakoutRoomAssignment[], until: number | null}} BreakoutAssignPayload
 * @typedef {{t: 'state', rooms: BreakoutRoomRef[], until: number | null}} BreakoutStatePayload
 *   the running session, replayed to whoever joins the main room late
 * @typedef {{t: 'join', room: string}} BreakoutJoinPayload
 *   a seat in the main room asks the host seat to be put into a room
 * @typedef {{t: 'seat', room: string, identity: string}} BreakoutSeatPayload
 *   a GUEST about to move into a room announces the identity it will hold
 *   there (the child token's `sub`), so a host can later `remove` it on
 *   the child — the moderation endpoint matches identities exactly and the
 *   child's 39004 lists pubkeys only (guests are on no roster)
 * @typedef {{t: 'end'}} BreakoutEndPayload
 * @typedef {BreakoutAssignPayload | BreakoutStatePayload | BreakoutJoinPayload | BreakoutSeatPayload | BreakoutEndPayload} BreakoutPayload
 */

/**
 * @param {{rooms: BreakoutRoomAssignment[], until?: number | null}} args
 * @returns {{t: 'assign', rooms: BreakoutRoomAssignment[], until?: number}}
 */
export function buildBreakoutAssignPayload({ rooms, until }) {
  return {
    t: 'assign',
    rooms: rooms.map((room) => ({
      id: room.id,
      relay: room.relay,
      name: room.name,
      members: [...room.members]
    })),
    ...(typeof until === 'number' && Number.isFinite(until) ? { until: Math.floor(until) } : {})
  };
}

/**
 * The session as a late joiner needs it: the rooms (no seats — nobody is
 * being sent anywhere) and the deadline.
 * @param {{rooms: BreakoutRoomRef[], until?: number | null}} args
 * @returns {{t: 'state', rooms: BreakoutRoomRef[], until?: number}}
 */
export function buildBreakoutStatePayload({ rooms, until }) {
  return {
    t: 'state',
    rooms: rooms.map((room) => ({ id: room.id, relay: room.relay, name: room.name })),
    ...(typeof until === 'number' && Number.isFinite(until) ? { until: Math.floor(until) } : {})
  };
}

/** @param {string} roomId @returns {BreakoutJoinPayload} */
export function buildBreakoutJoinPayload(roomId) {
  return { t: 'join', room: roomId };
}

/** @param {string} roomId @param {string} identity @returns {BreakoutSeatPayload} */
export function buildBreakoutSeatPayload(roomId, identity) {
  return { t: 'seat', room: roomId, identity };
}

/** @returns {BreakoutEndPayload} */
export function buildBreakoutEndPayload() {
  return { t: 'end' };
}

/**
 * @param {unknown} raw
 * @param {boolean} withMembers
 * @returns {BreakoutRoomAssignment[] | null}
 */
function parseRooms(raw, withMembers) {
  if (!Array.isArray(raw)) return null;
  /** @type {BreakoutRoomAssignment[]} */
  const rooms = [];
  for (const room of raw) {
    if (!room || typeof room !== 'object') return null;
    const { id, relay, name, members } = /** @type {Record<string, unknown>} */ (room);
    if (typeof id !== 'string' || !id) return null;
    if (typeof relay !== 'string' || !isValidRelayWebsocketUrl(relay)) return null;
    if (typeof name !== 'string') return null;
    if (withMembers) {
      if (!Array.isArray(members) || !members.every((m) => typeof m === 'string')) return null;
      rooms.push({ id, relay, name, members: [...members] });
    } else {
      rooms.push({ id, relay, name, members: [] });
    }
  }
  return rooms;
}

/**
 * Validate a decoded data message on the breakout topic. Anything that is
 * not exactly one of the known shapes is dropped (`null`).
 * @param {unknown} raw
 * @returns {BreakoutPayload | null}
 */
export function parseBreakoutPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const msg = /** @type {Record<string, unknown>} */ (raw);
  if (msg.t === 'end') return { t: 'end' };
  if (msg.t === 'join') {
    return typeof msg.room === 'string' && msg.room ? { t: 'join', room: msg.room } : null;
  }
  if (msg.t === 'seat') {
    return typeof msg.room === 'string' &&
      msg.room &&
      typeof msg.identity === 'string' &&
      msg.identity
      ? { t: 'seat', room: msg.room, identity: msg.identity }
      : null;
  }
  if (msg.t !== 'assign' && msg.t !== 'state') return null;
  const rooms = parseRooms(msg.rooms, msg.t === 'assign');
  if (!rooms) return null;
  let until = null;
  if (msg.until !== undefined && msg.until !== null) {
    if (typeof msg.until !== 'number' || !Number.isFinite(msg.until)) return null;
    until = msg.until;
  }
  if (msg.t === 'state') {
    return { t: 'state', rooms: rooms.map(({ id, relay, name }) => ({ id, relay, name })), until };
  }
  return { t: 'assign', rooms, until };
}

/**
 * The room a seat was assigned to, if any.
 * @param {BreakoutAssignPayload} payload
 * @param {string} identity
 */
export function assignedRoom(payload, identity) {
  return payload.rooms.find((room) => room.members.includes(identity)) ?? null;
}

/**
 * The room whose kind-39002 roster names `pubkey` — how a client in a
 * breakout room learns the host moved it (remove-user + put-user), and how
 * the host panel places people.
 * @template {{id: string}} R
 * @param {R[]} rooms
 * @param {Record<string, Set<string> | undefined>} membersByRoomId
 * @param {string} pubkey
 * @returns {R | null}
 */
export function roomOfPubkey(rooms, membersByRoomId, pubkey) {
  return rooms.find((room) => membersByRoomId[room.id]?.has(pubkey) === true) ?? null;
}

/**
 * Where a late joiner goes when the host lets the client distribute them:
 * the room with the fewest seated people (the host's own seat in every room
 * not counted), the lowest room number on a tie. Null without rooms.
 * @template {{id: string, index: number}} R
 * @param {R[]} rooms
 * @param {Record<string, Set<string> | undefined>} membersByRoomId
 * @param {string[]} [ignorePubkeys] seats that do not count (the host)
 * @returns {R | null}
 */
export function pickSmallestRoom(rooms, membersByRoomId, ignorePubkeys = []) {
  /** @type {R | null} */
  let best = null;
  let bestSize = Infinity;
  for (const room of [...rooms].sort((a, b) => a.index - b.index)) {
    const members = membersByRoomId[room.id];
    const size = members ? [...members].filter((p) => !ignorePubkeys.includes(p)).length : 0;
    if (size < bestSize) {
      best = room;
      bestSize = size;
    }
  }
  return best;
}

/**
 * Whole seconds left until `until` (unix seconds), clamped at 0; null when
 * there is no deadline.
 * @param {number | null | undefined} until
 * @param {number} nowMs
 */
export function remainingSeconds(until, nowMs) {
  if (typeof until !== 'number' || !Number.isFinite(until)) return null;
  return Math.max(0, Math.ceil(until - nowMs / 1000));
}

/** `m:ss`, or `h:mm:ss` from an hour on. @param {number} seconds */
export function formatCountdown(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}
