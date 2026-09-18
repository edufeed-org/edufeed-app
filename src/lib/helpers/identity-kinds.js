/**
 * The kinds that say WHO a user is and WHERE to reach them, as opposed to
 * what they published.
 *
 * They need a different distribution rule from content: content belongs on the
 * author's outbox (NIP-65) and the app's category relays, but an identity
 * event that only exists on the author's outbox is unresolvable for anyone who
 * has not already found that outbox — including, circularly, the kind 10002
 * that would have told them where to look.
 *
 * Kept in its own dependency-free module so both the publish path and UI code
 * can ask the question without pulling in the relay/config stack.
 */

/** @type {ReadonlySet<number>} */
export const IDENTITY_KINDS = new Set([
  0, // NIP-01 profile metadata
  3, // NIP-02 contact list
  10002, // NIP-65 relay list
  10050, // NIP-17 DM relay list
  10063 // Blossom server list
]);

/**
 * True when the event kind is identity infrastructure (see IDENTITY_KINDS).
 * @param {number} kind
 * @returns {boolean}
 */
export function isIdentityKind(kind) {
  return IDENTITY_KINDS.has(kind);
}
