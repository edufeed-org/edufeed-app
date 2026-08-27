// Kind-10222 channel pointers: ["group", <group id>, <relay>, <name?>]
//
// A community is EXTENDED by one protected area, and each of its channels is a
// standalone NIP-29 group. The community event carries only the GROUPING — one
// pointer per channel; the access rules stay on the relay, in each group's own
// kind:39000. See docs/superpowers/specs/2026-08-12-groups-architecture-design.md, Entwurf (c).
//
// Deliberately plural, unlike the concord pointer (src/lib/concord/pointer.js),
// which is singular by design: a community has ONE private area but MANY
// channels.
//
// The tag shape and its reader come from applesauce-common — the same `group`
// tag it already writes for the personal kind-10009 list. We add only what the
// library leaves to the caller: validation of untrusted tag values, and
// normalisation-aware identity so the same channel written twice stays one row.
import { getGroupPointerFromGroupTag } from 'applesauce-common/helpers/groups';
import { normalizeURL } from 'applesauce-core/helpers/url';
import { isValidRelayWebsocketUrl } from './groups.js';

/**
 * @typedef {{id: string, relay: string, name?: string, access?: 'members'|'invited'}} CommunityGroupPointer
 */

// 5th element: the community's intent for a PRIVATE channel — readable by
// everyone in the community, or only by the people put in it. The relay cannot
// express that split (both are a private group with a member list), so it
// lives here. Purely presentational; see src/lib/groups/channel-access.js.
const ACCESS_MARKERS = ['members', 'invited'];

/**
 * Identity of a channel: group id on a relay, compared after URL
 * normalisation so `wss://Host` and `wss://host/` are one channel.
 * @param {{id?: string, relay?: string}} pointer
 * @returns {string | null} null when the pointer is not addressable
 */
export function channelKey(pointer) {
  if (!pointer || typeof pointer.id !== 'string' || !pointer.id.trim()) return null;
  if (typeof pointer.relay !== 'string' || !isValidRelayWebsocketUrl(pointer.relay)) return null;
  return `${pointer.id}@${normalizeURL(pointer.relay)}`;
}

/**
 * Every channel pointer on a community event, in tag order.
 *
 * Read-only on purpose: applesauce's `getPublicGroups` memoises onto a Symbol
 * on the event, and community events are held in Svelte state where a cache
 * write from inside a `$derived` crashes the runtime (061c05c9). We map the
 * tags ourselves and keep the library's tag reader.
 *
 * @param {{ tags?: string[][], [key: string]: any } | null | undefined} event
 * @returns {CommunityGroupPointer[]}
 */
export function parseGroupPointers(event) {
  if (!event || !Array.isArray(event.tags)) return [];
  /** @type {CommunityGroupPointer[]} */
  const pointers = [];
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag[0] !== 'group') continue;
    const pointer = getGroupPointerFromGroupTag(tag);
    if (!channelKey(pointer)) continue;
    /** @type {CommunityGroupPointer} */
    const out = { id: pointer.id, relay: pointer.relay };
    if (pointer.name) out.name = pointer.name;
    if (ACCESS_MARKERS.includes(tag[4])) out.access = /** @type {'members'|'invited'} */ (tag[4]);
    pointers.push(out);
  }
  return pointers;
}

/**
 * The one relay every channel of this community lives on, or null.
 *
 * The relay badges on the channel overview describe ONE host. A community whose
 * channels are spread over two relays has no single answer, and picking either
 * host's badges would attach them to channels that host says nothing about — so
 * the badges are dropped instead of guessed. Compared after normalisation, for
 * the same reason {@link channelKey} is.
 *
 * Returns the first pointer's relay VERBATIM, not its normalised form: it is
 * what the community wrote, and it is what every other reader here is handed.
 *
 * @param {Array<{relay?: string, [key: string]: any}>} pointers
 * @returns {string | null}
 */
export function sharedRelayOf(pointers) {
  if (!Array.isArray(pointers) || pointers.length === 0) return null;
  /** @type {string | null} */
  let shared = null;
  for (const pointer of pointers) {
    if (typeof pointer?.relay !== 'string' || !isValidRelayWebsocketUrl(pointer.relay)) return null;
    const normalised = normalizeURL(pointer.relay);
    if (shared === null) shared = normalised;
    else if (shared !== normalised) return null;
  }
  return pointers[0].relay ?? null;
}

/**
 * @param {CommunityGroupPointer} pointer
 * @returns {string[]}
 */
export function buildGroupPointerTag(pointer) {
  const tag = ['group', pointer.id, pointer.relay];
  // The access marker sits in the 5th slot, so an unnamed channel that has one
  // still holds the name slot open rather than shifting access into it.
  if (pointer.name) tag.push(pointer.name);
  else if (pointer.access) tag.push('');
  if (pointer.access) tag.push(pointer.access);
  return tag;
}

/**
 * Return a NEW tags array with this channel's pointer set — appended when it
 * is new, replaced in place when the channel is already listed. Sibling
 * channels and every non-`group` tag are left alone.
 * @param {string[][]} tags
 * @param {CommunityGroupPointer} pointer
 * @returns {string[][]}
 */
export function withGroupPointer(tags, pointer) {
  const key = channelKey(pointer);
  const next = buildGroupPointerTag(pointer);
  let replaced = false;
  const out = tags.map((tag) => {
    if (!replaced && tag[0] === 'group' && channelKey(getGroupPointerFromGroupTag(tag)) === key) {
      replaced = true;
      return next;
    }
    return tag;
  });
  return replaced ? out : [...out, next];
}

/**
 * Return a NEW tags array with this channel's pointer removed (detach one
 * channel). Siblings stay.
 * @param {string[][]} tags
 * @param {CommunityGroupPointer} pointer
 * @returns {string[][]}
 */
export function withoutGroupPointer(tags, pointer) {
  const key = channelKey(pointer);
  return tags.filter(
    (tag) => !(tag[0] === 'group' && channelKey(getGroupPointerFromGroupTag(tag)) === key)
  );
}
