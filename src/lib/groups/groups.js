// NIP-29 relay groups — pure helpers for the /groups lane.
//
// A group lives ON one relay: `host'id` (Armada/applesauce pointer format,
// applesauce-common's decodeGroupPointer). Chat is kind 9 with an `h` tag —
// the same shape the app's public community chat already speaks — so the UI
// layer reuses the existing chat components wholesale; this module only
// covers what is NIP-29-specific: pointer parsing, the h-tagged event
// templates (message/join/leave), and kind-10009 groups-list updates.
//
// Event templates follow the app's own idiom (hand-rolled template objects,
// see Chat.svelte's sendMessage) rather than applesauce's EventFactory —
// the factory machinery isn't used anywhere in this app yet, and two
// two-tag templates don't justify introducing it.
import {
  decodeGroupPointer,
  encodeGroupPointer,
  GROUPS_LIST_KIND,
  JOIN_REQUEST_KIND,
  LEAVE_REQUEST_KIND,
  getPublicGroups
} from 'applesauce-common/helpers/groups';
import { normalizeURL } from 'applesauce-core/helpers/url';
import { buildReplyTags } from '$lib/helpers/threading.js';

/**
 * @typedef {{relay: string, id: string}} GroupPointer
 */

/**
 * Parse user input into a group pointer. Accepts `host'id`,
 * `wss://host'id`, and bare `host` (NIP-29 root group `_`). Null for
 * empty/unparseable input.
 * @param {string} input
 * @returns {GroupPointer | null}
 */
export function parseGroupInput(input) {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return null;
  try {
    const pointer = decodeGroupPointer(trimmed);
    if (!pointer?.relay || !isValidRelayUrl(pointer.relay)) return null;
    return { relay: pointer.relay, id: pointer.id || '_' };
  } catch {
    return null;
  }
}

/**
 * True when the relay URL carries a DNS-shaped host. Chrome's URL parser
 * percent-encodes forbidden host bytes (e.g. spaces) instead of throwing
 * like Node's does, so "new URL succeeded" proves nothing in a browser —
 * the host must be validated explicitly.
 * @param {string} relay
 */
export function isValidRelayUrl(relay) {
  /** @type {string} */
  let hostname;
  try {
    hostname = new URL(relay).hostname;
  } catch {
    return false;
  }
  // IPv6 literals arrive bracketed; unwrap and allow colons for them only.
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return /^[0-9a-f:]+$/i.test(hostname.slice(1, -1));
  }
  // DNS labels: alnum with inner hyphens, dot-separated. Rejects the
  // percent-escapes a lenient parser smuggles into the host.
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(hostname);
}

/**
 * A relay URL is a `ws:`/`wss:` URL with a DNS-shaped host — the scheme NIP-29
 * groups actually connect over. {@link isValidRelayUrl} deliberately skips the
 * scheme check (its caller reaches it through `decodeGroupPointer`, which has
 * already forced a scheme); this is for callers validating a raw, untrusted
 * value — e.g. a user-typed relay URL in a "create group" form, which would
 * otherwise happily accept `https://` and only fail once the group already
 * exists on the relay.
 * @param {string} relay
 */
export function isValidRelayWebsocketUrl(relay) {
  /** @type {string} */
  let protocol;
  try {
    protocol = new URL(relay).protocol;
  } catch {
    return false;
  }
  return (protocol === 'ws:' || protocol === 'wss:') && isValidRelayUrl(relay);
}

/**
 * The pointer as a string, in the shortest form that still addresses the SAME
 * relay.
 *
 * `encodeGroupPointer` emits `new URL(relay).hostname`, so a port and a `ws:`
 * scheme are silently dropped — the resulting pointer then names a different
 * relay, and the failure is a connection to nothing rather than an error.
 * `decodeGroupPointer` reads the spelled-out relay losslessly, so fall back to
 * that whenever the short form would not decode back to where we started.
 * @param {GroupPointer} pointer
 * @returns {string}
 */
export function groupPointerString(pointer) {
  const short = encodeGroupPointer(pointer);
  try {
    const decoded = decodeGroupPointer(short);
    if (decoded?.relay && normalizeURL(decoded.relay) === normalizeURL(pointer.relay)) return short;
  } catch {
    // unparseable short form — spell it out
  }
  return `${pointer.relay}'${pointer.id}`;
}

/**
 * App route for a group, with the pointer URL-encoded once.
 * @param {GroupPointer} pointer
 */
export function groupHref(pointer) {
  return `/groups/${encodeURIComponent(groupPointerString(pointer))}`;
}

/**
 * Kind-9 group chat message: `h` tag first (same shape as the public
 * community chat), optional NIP-10 marked reply.
 *
 * `replyTo` is the message being replied to WITH ITS TAGS — the thread root is
 * resolved from them (see helpers/threading.js). Passing only `{id, pubkey}`
 * still works and yields the top-level shape, which is correct for a message
 * that has no tags to inherit a root from.
 * @param {string} groupId
 * @param {string} content
 * @param {{id: string, pubkey: string, tags?: string[][]} | null} [replyTo]
 * @returns {{kind: number, content: string, created_at: number, tags: string[][]}}
 */
export function buildGroupMessageTemplate(groupId, content, replyTo = null) {
  /** @type {string[][]} */
  const tags = [['h', groupId]];
  if (replyTo) {
    tags.push(...buildReplyTags(replyTo));
    tags.push(['p', replyTo.pubkey]);
  }
  return { kind: 9, content, created_at: Math.floor(Date.now() / 1000), tags };
}

/**
 * Kind-9021 join request (NIP-29). The optional invite code rides as a
 * `code` tag.
 * @param {string} groupId
 * @param {string} [code]
 */
export function buildJoinRequestTemplate(groupId, code) {
  /** @type {string[][]} */
  const tags = [['h', groupId]];
  if (code) tags.push(['code', code]);
  return { kind: JOIN_REQUEST_KIND, content: '', created_at: Math.floor(Date.now() / 1000), tags };
}

/**
 * Kind-9022 leave request (NIP-29).
 * @param {string} groupId
 */
export function buildLeaveRequestTemplate(groupId) {
  return {
    kind: LEAVE_REQUEST_KIND,
    content: '',
    created_at: Math.floor(Date.now() / 1000),
    tags: [['h', groupId]]
  };
}

/**
 * Kind-10009 groups-list update: preserves every non-`group` tag and the
 * content (the NIP-51 hidden section) verbatim, then adds or removes ONE
 * public `["group", id, relay]` entry. Dedupe is by (id, relay).
 * @param {{content?: string, tags?: string[][]} | null | undefined} existing the current 10009 event, if any
 * @param {{add?: GroupPointer, remove?: GroupPointer}} change
 * @returns {{kind: number, content: string, created_at: number, tags: string[][]}}
 */
export function buildGroupsListTemplate(existing, change) {
  const keepTags = (existing?.tags ?? []).filter((t) => t[0] !== 'group');
  /** @type {GroupPointer[]} */
  let groups = existing ? (getPublicGroups(/** @type {any} */ (existing)) ?? []) : [];

  if (change.remove) {
    const target = change.remove;
    groups = groups.filter((g) => !(g.id === target.id && g.relay === target.relay));
  }
  if (change.add) {
    const target = change.add;
    groups = groups.filter((g) => !(g.id === target.id && g.relay === target.relay));
    groups.push(target);
  }

  return {
    kind: GROUPS_LIST_KIND,
    content: existing?.content ?? '',
    created_at: Math.floor(Date.now() / 1000),
    tags: [...keepTags, ...groups.map((g) => ['group', g.id, g.relay])]
  };
}

/**
 * Whether a relay refusal means "you are not a member here". Wordings
 * measured live: buzz answers "blocked: unknown member", hzrd149's blossom
 * endpoint "relay membership required", khatru variants "not a member".
 * @param {unknown} error
 * @returns {boolean}
 */
export function isMembershipRefusal(error) {
  const message = String(/** @type {any} */ (error)?.message ?? '');
  return /unknown member|not a member|membership required/i.test(message);
}
