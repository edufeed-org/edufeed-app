// Which communities a NIP-29 roster member can SHARE into — pure half.
//
// The direct counterpart of concord/shareable-communities.js, for the other
// membership engine. That file's reasoning applies verbatim here:
//
//   The follow set (kind 30000, d=communities) is the public "I joined"
//   signal, and share pickers listed exactly that. But a moderated
//   community's membership IS its root group's roster — the NIP draft says
//   so, and says "Follower ≠ member" in as many words. Roster membership is
//   granted BY AN ADMIN via a kind-9000, and an admin cannot write the
//   grantee's kind-30000: it is that user's own replaceable event. So a
//   member — or a publisher, holding explicit publish rights — had no way to
//   share into their own community (laoc, 2026-08-21: laoc tester was made
//   publisher of laoc42 and the community was absent from every picker).
//
// Roster membership is therefore the third membership signal, alongside the
// public follow set and Concord's private area membership: any 10222 whose
// `membership` pointer names a group I am on the roster of is a community I
// belong to, whatever the follow set says.
import { parseMembershipPointer } from './community-membership.js';

/**
 * Community pubkeys whose 10222 points at one of the given root groups.
 * @param {{groupIds?: Set<string> | string[], communikeyEvents?: any[] | null}} args
 * @returns {string[]} deduped, in event order
 */
export function rosterLinkedCommunityPubkeys({ groupIds, communikeyEvents } = {}) {
  const ids = groupIds instanceof Set ? groupIds : new Set(groupIds ?? []);
  if (ids.size === 0) return [];

  /** @type {string[]} */
  const out = [];
  for (const event of communikeyEvents ?? []) {
    // parseMembershipPointer, not a hand-rolled tag scan: it enforces the
    // relay-url validity rule, so this and community-type derivation can
    // never disagree about whether a community is moderated.
    const pointer = parseMembershipPointer(event);
    if (!pointer || !ids.has(pointer.id)) continue;
    if (event?.pubkey && !out.includes(event.pubkey)) out.push(event.pubkey);
  }
  return out;
}
