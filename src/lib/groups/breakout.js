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
// Why a marker in `about` and not a custom tag: pyramid regenerates a group's
// 39000 from its own Group struct (nip29.Group.ToMetadataEvent), so only
// name / about / picture / the status flags / parent survive — a `t` or
// `breakout` tag on the 9002 would simply vanish. `about` is free text the
// relay keeps verbatim, and a room is hidden from every list anyway, so its
// "description" is never shown to anyone.
import { GROUP_METADATA_KIND } from 'applesauce-common/helpers/groups';
import { isValidRelayWebsocketUrl } from './groups.js';

/** LiveKit data-message topic for breakout assignments (never the chat's). */
export const BREAKOUT_TOPIC = 'edufeed.call.breakout';
export const BREAKOUT_MIN_ROOMS = 2;
export const BREAKOUT_MAX_ROOMS = 8;
/** How long the "you were assigned to room N" prompt waits before switching. */
export const BREAKOUT_AUTO_SWITCH_MS = 5000;
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

/**
 * @param {{kind?: number, tags?: string[][]} | null | undefined} metadataEvent a kind 39000
 * @returns {{parent: string, index: number, until: number | null} | null}
 */
export function parseBreakoutMarker(metadataEvent) {
  if (!metadataEvent || !Array.isArray(metadataEvent.tags)) return null;
  const about = metadataEvent.tags.find((t) => Array.isArray(t) && t[0] === 'about')?.[1];
  if (typeof about !== 'string' || !about.startsWith(`${MARKER} `)) return null;
  /** @type {Record<string, string>} */
  const fields = {};
  for (const part of about.slice(MARKER.length + 1).split(/\s+/)) {
    const eq = part.indexOf('=');
    if (eq > 0) fields[part.slice(0, eq)] = part.slice(eq + 1);
  }
  const index = Number(fields.n);
  if (!fields.parent || !Number.isInteger(index) || index < 1) return null;
  const until = fields.until !== undefined ? Number(fields.until) : null;
  return {
    parent: fields.parent,
    index,
    until: until !== null && Number.isFinite(until) ? until : null
  };
}

/**
 * Whether a kind-39000 describes a breakout room. Every channel list, the
 * sidebar, `/groups`, discovery and the community calendar drop these.
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
 * The metadata a room is created with (`createGroupOnRelay`): hidden from
 * listings, closed (nobody self-joins — the host seats people), PUBLIC so
 * every participant can read every room's roster (pyramid hides a private
 * group's 39002 from non-members, and following the rosters is how a client
 * learns it was moved), an AV space, and — when the host holds a role in
 * the channel — a child of it. `withParent: false` is the fallback for a
 * host who is only a member of the channel: pyramid rejects a `parent` from
 * anyone without a role in the parent (reject-event.go), and the marker
 * names the parent anyway.
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
 * @typedef {{t: 'assign', rooms: BreakoutRoomAssignment[], until: number | null}} BreakoutAssignPayload
 * @typedef {{t: 'end'}} BreakoutEndPayload
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

/** @returns {BreakoutEndPayload} */
export function buildBreakoutEndPayload() {
  return { t: 'end' };
}

/**
 * Validate a decoded data message on the breakout topic. Anything that is
 * not exactly one of the two shapes is dropped (`null`).
 * @param {unknown} raw
 * @returns {BreakoutAssignPayload | BreakoutEndPayload | null}
 */
export function parseBreakoutPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const msg = /** @type {Record<string, unknown>} */ (raw);
  if (msg.t === 'end') return { t: 'end' };
  if (msg.t !== 'assign' || !Array.isArray(msg.rooms)) return null;
  /** @type {BreakoutRoomAssignment[]} */
  const rooms = [];
  for (const room of msg.rooms) {
    if (!room || typeof room !== 'object') return null;
    const { id, relay, name, members } = /** @type {Record<string, unknown>} */ (room);
    if (typeof id !== 'string' || !id) return null;
    if (typeof relay !== 'string' || !isValidRelayWebsocketUrl(relay)) return null;
    if (typeof name !== 'string') return null;
    if (!Array.isArray(members) || !members.every((m) => typeof m === 'string')) return null;
    rooms.push({ id, relay, name, members: [...members] });
  }
  let until = null;
  if (msg.until !== undefined && msg.until !== null) {
    if (typeof msg.until !== 'number' || !Number.isFinite(msg.until)) return null;
    until = msg.until;
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
