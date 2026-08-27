// src/lib/groups/community-membership.js
//
// Kind-10222 membership machinery per docs/nips/communikey-groups.md:
//   ["membership", <root-group-id>, <relay>]  — the NIP-29 root group whose
//     roster/roles ARE the community membership (moderated communities).
//   ["application", "30168:<pubkey>:<d>", <relay?>] — LEGACY: the optional
//     structured intake form was removed as YAGNI (laoc, 2026-08-18);
//     joining is invite-code only. Old events may still carry the tag —
//     it round-trips through saves and is stripped on flip-to-open.
// Singular by design, like the concord pointer and unlike the plural
// channel `group` tags (src/lib/groups/community-pointer.js).
//
// Community TYPE is derived, never declared: concord pointer → closed,
// membership pointer → moderated, neither → open. XOR violation → open.
import { parseConcordPointer } from '$lib/concord/pointer.js';
import { hasUngatedPublicSections } from '$lib/concord/publisher-window.js';
import { isValidRelayWebsocketUrl } from './groups.js';

export const MEMBERSHIP_TAG = 'membership';
export const APPLICATION_TAG = 'application';

/** @typedef {{id: string, relay: string}} MembershipPointer */
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

/**
 * NEW tags array with every application tag removed. The application-form
 * layer itself was removed as YAGNI (laoc, 2026-08-18) — this survives so
 * flip-to-open still strips legacy `application` tags off communities
 * created before the removal.
 * @param {string[][]} tags
 * @returns {string[][]}
 */
export function withoutApplicationRef(tags) {
  return tags.filter((tag) => !(Array.isArray(tag) && tag[0] === APPLICATION_TAG));
}

/**
 * Community type, derived from the event's pointer tags — never declared.
 * XOR violation (both pointers) is invalid per the NIP draft: fail open.
 * @param {{tags?: string[][], pubkey?: string} | null | undefined} event
 * @returns {CommunityType}
 */
export function deriveCommunityType(event) {
  if (!event) return 'open';
  const concord = parseConcordPointer(event);
  const membership = parseMembershipPointer(event);
  if (concord && membership) return 'open';
  if (concord) {
    // Concord alone is GESCHLOSSEN for the wizard's shell shape (zero public
    // sections) AND for the window shape (every section gated by the
    // community's own publishers list — "Privat mit Schaufenster"): only
    // consented publishers share there, so "Offen — alle können teilen"
    // would be a lie. An ordinary community that links/founds a private
    // area keeps its UNGATED public sections and stays open "mit privatem
    // Bereich" (laoc, 2026-08-17).
    return hasUngatedPublicSections(event.tags ?? [], event.pubkey ?? '') ? 'open' : 'closed';
  }
  if (membership) return 'moderated';
  return 'open';
}
