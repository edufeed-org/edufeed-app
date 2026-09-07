// Two relay-observable channel tiers map straight onto NIP-29's markers — no
// pointer marker, nothing bolted on (design locked 2026-08-20, laoc):
//   world   — NOT `private` (anyone reads) + `open` (bare kind-9021 self-join,
//             the relay auto-admits)
//   invited — `private` (only put-in members read) + `closed` (join needs an
//             admin: put-user or an invite code)
// `restricted` rides along in metadataTags (group-management.js). The old
// relay-trust "members" tier (community-only-read, faked via the dropped
// kind-10222 group-pointer marker) is retired — "all community members,
// privately" is Concord's job (E2E-encrypted, stronger than a relay-trust
// private group).

/**
 * @param {{tier: 'world'|'invited'|'members', hidden?: boolean}} choice
 *   `members` (a Concord-only tier) never reaches this NIP-29 mapper in
 *   practice, but the wizard's shared `tier` state carries the union — it
 *   fails closed here (not 'world' → private). `hidden` (unlisted room) only
 *   applies on top of a private tier: the wizard shows the checkbox for
 *   `invited` alone, but its state survives a tier switch, so a stale flag
 *   must never make a deliberately discoverable 'world' room unlisted.
 * @returns {{isPublic: boolean, isOpen: boolean, isHidden: boolean}}
 */
export function accessChoiceToNip29({ tier, hidden = false }) {
  // Fail closed: anything that is not explicitly 'world' is private + closed.
  const isWorld = tier === 'world';
  return {
    isPublic: isWorld,
    isOpen: isWorld,
    isHidden: !isWorld && hidden
  };
}
