// src/lib/groups/community-membership.js
//
// Kind-10222 membership machinery per docs/nips/communikey-groups.md:
//   ["membership", <root-group-id>, <relay>]  — the NIP-29 root group whose
//     roster/roles ARE the community membership (moderated communities).
//   ["application", "30168:<pubkey>:<d>", <relay?>] — optional structured
//     intake form for joining.
// Both singular by design, like the concord pointer and unlike the plural
// channel `group` tags (src/lib/groups/community-pointer.js).
//
// Community TYPE is derived, never declared: concord pointer → closed,
// membership pointer → moderated, neither → open. XOR violation → open.
import { parseConcordPointer } from '$lib/concord/pointer.js';
import { isValidRelayWebsocketUrl } from './groups.js';

export const MEMBERSHIP_TAG = 'membership';
export const APPLICATION_TAG = 'application';

/** @typedef {{id: string, relay: string}} MembershipPointer */
/** @typedef {{address: string, relay?: string | null}} ApplicationRef */
/** @typedef {'open' | 'moderated' | 'closed'} CommunityType */

/**
 * First valid membership pointer on a community event, or null.
 * @param {{tags?: string[][]} | null | undefined} event
 * @returns {MembershipPointer | null}
 */
export function parseMembershipPointer(event) {
  if (!event || !Array.isArray(event.tags)) return null;
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag[0] !== MEMBERSHIP_TAG) continue;
    const id = typeof tag[1] === 'string' ? tag[1].trim() : '';
    const relay = tag[2];
    if (!id || typeof relay !== 'string' || !isValidRelayWebsocketUrl(relay)) continue;
    return { id, relay };
  }
  return null;
}

/**
 * @param {MembershipPointer} pointer
 * @returns {string[]}
 */
export function buildMembershipTag(pointer) {
  return [MEMBERSHIP_TAG, pointer.id, pointer.relay];
}

/**
 * NEW tags array with every membership tag removed.
 * @param {string[][]} tags
 * @returns {string[][]}
 */
export function withoutMembershipPointer(tags) {
  return tags.filter((tag) => !(Array.isArray(tag) && tag[0] === MEMBERSHIP_TAG));
}

/**
 * NEW tags array with exactly one membership tag (singular by spec).
 * @param {string[][]} tags
 * @param {MembershipPointer} pointer
 * @returns {string[][]}
 */
export function withMembershipPointer(tags, pointer) {
  return [...withoutMembershipPointer(tags), buildMembershipTag(pointer)];
}

/** @param {unknown} address @returns {address is string} */
function isFormAddress(address) {
  if (typeof address !== 'string' || !address.startsWith('30168:')) return false;
  const parts = address.split(':');
  return parts.length === 3 && parts[1].length > 0 && parts[2].length > 0;
}

/**
 * First valid application-form reference on a community event, or null.
 * @param {{tags?: string[][]} | null | undefined} event
 * @returns {{address: string, relay: string | null} | null}
 */
export function parseApplicationRef(event) {
  if (!event || !Array.isArray(event.tags)) return null;
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag[0] !== APPLICATION_TAG) continue;
    if (!isFormAddress(tag[1])) continue;
    return { address: tag[1], relay: typeof tag[2] === 'string' && tag[2] ? tag[2] : null };
  }
  return null;
}

/**
 * @param {ApplicationRef} ref
 * @returns {string[]}
 */
export function buildApplicationTag(ref) {
  const tag = [APPLICATION_TAG, ref.address];
  if (ref.relay) tag.push(ref.relay);
  return tag;
}

/**
 * @param {string[][]} tags
 * @returns {string[][]}
 */
export function withoutApplicationRef(tags) {
  return tags.filter((tag) => !(Array.isArray(tag) && tag[0] === APPLICATION_TAG));
}

/**
 * @param {string[][]} tags
 * @param {ApplicationRef} ref
 * @returns {string[][]}
 */
export function withApplicationRef(tags, ref) {
  return [...withoutApplicationRef(tags), buildApplicationTag(ref)];
}

/**
 * Community type, derived from the event's pointer tags — never declared.
 * XOR violation (both pointers) is invalid per the NIP draft: fail open.
 * @param {{tags?: string[][]} | null | undefined} event
 * @returns {CommunityType}
 */
export function deriveCommunityType(event) {
  if (!event) return 'open';
  const concord = parseConcordPointer(event);
  const membership = parseMembershipPointer(event);
  if (concord && membership) return 'open';
  if (concord) {
    // Concord alone is only GESCHLOSSEN for the wizard's shell shape (zero
    // public sections). An ordinary community that links/founds a private
    // area keeps its public content sections and stays open "mit privatem
    // Bereich" — deriving those as closed would hide their public content
    // behind the shell (laoc, 2026-08-17).
    const hasPublicSections = (event.tags ?? []).some(
      (tag) => Array.isArray(tag) && tag[0] === 'content'
    );
    return hasPublicSections ? 'open' : 'closed';
  }
  if (membership) return 'moderated';
  return 'open';
}
