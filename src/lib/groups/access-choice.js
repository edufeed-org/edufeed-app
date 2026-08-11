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
