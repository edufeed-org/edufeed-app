// Design B2 (buzz thread, round 4): two answers plus a weltoffen sub-toggle
// map onto NIP-29's markers. `restricted` rides along in metadataTags
// (group-management.js).
//
// Superseded 2026-08-19 (laoc): world channels (tier 'members' +
// worldReadable) are now also `isOpen` — relays auto-admit bare kind-9021
// self-joins for them, so joining is no longer an admin action there.
// members-only and invited channels stay `closed`: joining still needs
// relay policy or an admin invite code.

/**
 * @param {{tier: 'members'|'invited', worldReadable?: boolean}} choice
 * @returns {{isPublic: boolean, isOpen: boolean, access: 'members'|'invited'}}
 */
export function accessChoiceToNip29({ tier, worldReadable = false }) {
  const isWorld = tier === 'members' && worldReadable === true;
  return {
    isPublic: isWorld,
    isOpen: isWorld,
    access: tier
  };
}
