// Can this user's share into a community actually be SEEN? — pure half.
//
// Gated sections filter displayed content to the profile list's authors
// (allowedAuthors read path), so a share by anyone else publishes fine and
// then silently never renders (laoc, 2026-08-17: a member's resource share
// vanished into laoc tester's publisher-gated Learning section). Share
// pickers use this to disable those rows instead of letting the share
// disappear.
import { parseCommunityContentTypes } from './communityRelays.js';

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
