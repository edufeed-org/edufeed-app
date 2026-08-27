// Can this user's share into a community actually be SEEN? — pure half.
//
// Gated sections filter displayed content to the profile list's authors
// (allowedAuthors read path), so a share by anyone else publishes fine and
// then silently never renders (laoc, 2026-08-17: a member's resource share
// vanished into laoc tester's publisher-gated Learning section). Share
// pickers use this to disable those rows instead of letting the share
// disappear.
import { parseCommunityContentTypes } from './communityRelays.js';
import { parseMembershipPointer } from '$lib/groups/community-membership.js';

/**
 * The content section covering `kind`, or null. Shared by both gate kinds
 * below — a moderated community's gate lives in the section's `access` tier
 * rather than in a profile-list a-tag, so callers need the section itself.
 * @param {any} communikeyEvent kind 10222 (or null while loading)
 * @param {number | undefined} kind
 * @returns {import('./communityRelays.js').ContentTypeConfig | null}
 */
export function sectionForKind(communikeyEvent, kind) {
  if (!communikeyEvent || kind === undefined) return null;
  return (
    parseCommunityContentTypes(communikeyEvent).find((s) => s.kinds.includes(Number(kind))) ?? null
  );
}

/**
 * The roster-based gate covering `kind`, or null when publishing that kind is
 * open. The moderated-community counterpart of sectionGateForKind: instead of
 * a profile list it returns the section's `access` tier plus the root-group
 * pointer the caller needs to resolve it against.
 *
 * Fails open on a community with no `membership` pointer even if a section
 * carries an `access` tag: `access` is moderated-only per the NIP draft, and
 * without a roster there is nothing to evaluate the rule against — marking
 * the row restricted would grey it out for a rule nobody can check.
 *
 * @param {any} communikeyEvent kind 10222 (or null while loading)
 * @param {number | undefined} kind
 * @returns {{section: any, access: {tier: string, role?: string}, pointer: {id: string, relay: string}} | null}
 */
export function rosterGateForKind(communikeyEvent, kind) {
  return rosterGate(communikeyEvent, sectionForKind(communikeyEvent, kind));
}

/**
 * Same gate, found by section name instead of kind — what a rendered
 * community view has to hand.
 * @param {any} communikeyEvent kind 10222 (or null while loading)
 * @param {string | null | undefined} sectionName
 * @returns {{section: any, access: {tier: string, role?: string}, pointer: {id: string, relay: string}} | null}
 */
export function rosterGateForSection(communikeyEvent, sectionName) {
  if (!communikeyEvent || !sectionName) return null;
  return rosterGate(
    communikeyEvent,
    parseCommunityContentTypes(communikeyEvent).find((s) => s.name === sectionName) ?? null
  );
}

/** @param {any} communikeyEvent @param {any} section */
function rosterGate(communikeyEvent, section) {
  const access = section?.access;
  if (!access || access.tier === 'all') return null;
  const pointer = parseMembershipPointer(communikeyEvent);
  if (!pointer) return null;
  return { section, access, pointer };
}

/**
 * The profile-list gate covering `kind` in this community, or null when
 * publishing that kind is open (no section for the kind, or an ungated
 * section — both fail open: restriction marking must never block on missing
 * data).
 * @param {any} communikeyEvent kind 10222 (or null while loading)
 * @param {number | undefined} kind event kind being shared
 * @returns {{address: string, relay: string | null} | null}
 */
export function sectionGateForKind(communikeyEvent, kind) {
  if (!communikeyEvent || kind === undefined) return null;
  const section = parseCommunityContentTypes(communikeyEvent).find((s) =>
    s.kinds.includes(Number(kind))
  );
  if (!section?.profileList) return null;
  return { address: section.profileList, relay: section.profileListRelay ?? null };
}

/**
 * Whether the user's share would be visible behind this gate. The community
 * key itself always passes (spec: section content is "listed publishers or
 * the community key"). A missing list event fails OPEN — an unloaded list
 * must not grey out a legitimate publisher.
 * @param {{
 *   userPubkey: string | undefined,
 *   communityPubkey: string,
 *   listEvent: {tags?: string[][]} | null | undefined
 * }} args
 * @returns {boolean}
 */
export function shareWouldBeVisible({ userPubkey, communityPubkey, listEvent }) {
  if (!userPubkey) return false;
  if (userPubkey === communityPubkey) return true;
  if (!listEvent) return true;
  return (listEvent.tags ?? []).some(
    (tag) => Array.isArray(tag) && tag[0] === 'p' && tag[1] === userPubkey
  );
}
