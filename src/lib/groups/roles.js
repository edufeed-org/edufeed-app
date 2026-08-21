// src/lib/groups/roles.js
//
// NIP-29 role-token semantics — pure, no imports, so gating and tests can use
// it without dragging in paraglide (roleLabel in ./role-labels.js is the
// display half).
//
// NIP-29 has exactly one place to record a role: the group's kind 39001, the
// list the spec calls "admins" in a broad sense. So `publisher` — the role
// that grants nothing but the right to publish into a role-gated content
// section (docs/nips/communikey-groups.md `access`) — lands in 39001 next to
// the actual moderators. Everything here exists to keep those apart: on the
// wire they share a list, in the UI and in permission checks they must not.
//
// The relay side of the same distinction is pyramid-edufeed's
// hasModerationRole (groups/state.go), which is what stops a publisher from
// issuing 9000/9001.

export const PUBLISHER_ROLE = 'publisher';

/**
 * Role tokens that carry moderation authority. `king` is relay-assigned by
 * groups.0xchat.com to a group's creator; `moderator` is pyramid's secondary
 * role. Custom community roles are never moderation roles.
 * @type {readonly string[]}
 */
export const MODERATION_ROLES = Object.freeze(['admin', 'king', 'moderator']);

/**
 * @param {string[] | undefined | null} roles
 * @returns {boolean}
 */
export function hasModerationRole(roles) {
  return (roles ?? []).some((role) => MODERATION_ROLES.includes(role?.toLowerCase?.()));
}

/**
 * @param {string[] | undefined | null} roles
 * @returns {boolean}
 */
export function isPublisher(roles) {
  return (roles ?? []).some((role) => role?.toLowerCase?.() === PUBLISHER_ROLE);
}

/**
 * A publisher who is NOT also a moderator — the group the members UI lists
 * under "Publisher" rather than under "Admins".
 * @param {string[] | undefined | null} roles
 * @returns {boolean}
 */
export function isPublisherOnly(roles) {
  return isPublisher(roles) && !hasModerationRole(roles);
}

/**
 * NEW role array with the publisher role present. A 9000 put-user replaces a
 * member's whole role set, so grants must be built from the current roles
 * rather than sent alone.
 * @param {string[] | undefined | null} roles
 * @returns {string[]}
 */
export function withPublisherRole(roles) {
  const current = [...(roles ?? [])];
  return isPublisher(current) ? current : [...current, PUBLISHER_ROLE];
}

/**
 * NEW role array with the publisher role removed, keeping every other role.
 * @param {string[] | undefined | null} roles
 * @returns {string[]}
 */
export function withoutPublisherRole(roles) {
  return (roles ?? []).filter((role) => role?.toLowerCase?.() !== PUBLISHER_ROLE);
}
