// src/lib/groups/community-follow.js
//
// "The root roster holds me, so the follow set should say I'm here."
//
// A moderated community's membership lives in its root group's 39001/39002 —
// that IS the membership (docs/nips/communikey-groups.md). The kind-30000
// `communities` follow set is a separate, client-side list, and nothing joins
// the two: a 9021 join, an invite-code redemption and an admin-side role grant
// all leave the follow set untouched. The consequence a user actually sees is
// that the community they belong to has no rail entry until they separately
// press Follow — and until then its channels appear as a loose relay tile with
// no content types (laoc, 2026-08-24).
//
// Pure. The subscriptions, the ledger and the write live in
// community-follow-reconcile.svelte.js.
import { deriveCommunityType } from './community-membership.js';

/**
 * @param {{
 *   communityEvent: {pubkey?: string, tags?: string[][]} | null | undefined,
 *   userPubkey: string | null | undefined,
 *   roster: {isLoading?: boolean, isMember?: (pubkey: string) => boolean} | null | undefined,
 *   joinedCommunities: string[] | null | undefined
 * }} input
 * @returns {boolean}
 */
export function shouldFollowFromRoster({ communityEvent, userPubkey, roster, joinedCommunities }) {
  const community = communityEvent?.pubkey;
  if (!community || !userPubkey || !roster) return false;
  // The community keypair is its own owner — following itself says nothing.
  if (community === userPubkey) return false;
  // Only moderated communities HAVE a root roster to be held by. An open one
  // needs no membership at all; a closed one is joined through Concord.
  if (deriveCommunityType(communityEvent) !== 'moderated') return false;
  // "Not answered yet" is not "not a member" — the same rule every other
  // roster consumer follows (roster-access.js, roster-reconcile).
  if (roster.isLoading) return false;
  if (!roster.isMember?.(userPubkey)) return false;
  return !(joinedCommunities ?? []).includes(community);
}
