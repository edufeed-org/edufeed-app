// Kind-10222 channel pointers: ["group", <group id>, <relay>, <name?>]
//
// A community is EXTENDED by one protected area, and each of its channels is a
// standalone NIP-29 group. The community event carries only the GROUPING — one
// pointer per channel; the access rules stay on the relay, in each group's own
// kind:39000. See PLANS/EDUFEED_APP_GRUPPEN_MERGE.md, Entwurf (c).
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
import { isValidRelayUrl } from './groups.js';

/**
 * @typedef {{id: string, relay: string, name?: string}} CommunityGroupPointer
 */

/**
 * Identity of a channel: group id on a relay, compared after URL
 * normalisation so `wss://Host` and `wss://host/` are one channel.
 * @param {{id?: string, relay?: string}} pointer
 * @returns {string | null} null when the pointer is not addressable
 */
function channelKey(pointer) {
  if (!pointer || typeof pointer.id !== 'string' || !pointer.id.trim()) return null;
  if (typeof pointer.relay !== 'string' || !isRelayUrl(pointer.relay)) return null;
  return `${pointer.id}@${normalizeURL(pointer.relay)}`;
}

/**
 * A relay URL is a `ws:`/`wss:` URL with a DNS-shaped host. The host rule
 * lives in {@link isValidRelayUrl}; only the scheme is added here, because
 * that helper's own caller reaches it through `decodeGroupPointer`, which has
 * already forced a scheme — a raw tag value has not.
 * @param {string} relay
 */
function isRelayUrl(relay) {
  let protocol;
  try {
    protocol = new URL(relay).protocol;
  } catch {
    return false;
  }
  return (protocol === 'ws:' || protocol === 'wss:') && isValidRelayUrl(relay);
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
    pointers.push(
      pointer.name
        ? { id: pointer.id, relay: pointer.relay, name: pointer.name }
        : { id: pointer.id, relay: pointer.relay }
    );
  }
  return pointers;
}

/**
 * @param {CommunityGroupPointer} pointer
 * @returns {string[]}
 */
export function buildGroupPointerTag(pointer) {
  const tag = ['group', pointer.id, pointer.relay];
  if (pointer.name) tag.push(pointer.name);
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
