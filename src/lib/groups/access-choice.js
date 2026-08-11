// Design B2 (buzz thread, round 4): two answers plus a weltoffen sub-toggle
// map onto NIP-29's markers. Joining is ALWAYS an admin action for
// wizard-created channels (`closed`), and `restricted` rides along in
// metadataTags (group-management.js) — open only ever means open to READ.

/**
 * @param {{tier: 'members'|'invited', worldReadable?: boolean}} choice
 * @returns {{isPublic: boolean, isOpen: boolean, access: 'members'|'invited'}}
 */
export function accessChoiceToNip29({ tier, worldReadable = false }) {
  return {
    isPublic: tier === 'members' && worldReadable,
    isOpen: false,
    access: tier
  };
}

/**
 * What the disclosure line should say. World is the ABSENCE of `private` on
 * the raw 39000 (same rule as channel-access.js — applesauce's isPublic
 * reads a dead draft); members vs invited is the community's intent from the
 * pointer's access slot, defaulting to the stricter reading.
 * @param {{kind?: number, tags?: string[][]} | null | undefined} metadataEvent
 * @param {string | undefined} access
 * @returns {'world'|'members'|'invited'|'unknown'}
 */
export function disclosureKind(metadataEvent, access) {
  if (!metadataEvent || metadataEvent.kind !== 39000 || !Array.isArray(metadataEvent.tags)) {
    return 'unknown';
  }
  const isPrivate = metadataEvent.tags.some((t) => t[0] === 'private');
  if (!isPrivate) return 'world';
  return access === 'members' ? 'members' : 'invited';
}
