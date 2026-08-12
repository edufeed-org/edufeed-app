// Kind-10222 pointer: ["concord", <community_id hex64 lowercase>, <relay?>]
// Makes the EXISTENCE of a community's private area public; contents stay
// encrypted per CORD-01. Spec: docs/superpowers/specs/2026-07-23-concord-private-channels-design.md §3.2

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Whether a string is a well-formed Concord community id (64-char lowercase
 * hex). Exported so callers validating an id from untrusted input outside a
 * pointer tag — e.g. the `/private/<id>` route's URL param — share the same
 * rule as {@link parseConcordPointer}.
 * @param {unknown} value
 * @returns {value is string}
 */
export function isConcordCommunityId(value) {
  return typeof value === 'string' && HEX64.test(value);
}

/**
 * @param {string} communityId
 * @param {string} [relay]
 * @returns {string[]}
 */
export function buildConcordPointerTag(communityId, relay) {
  return relay ? ['concord', communityId, relay] : ['concord', communityId];
}

/**
 * Parse the concord pointer from a kind 10222 event. Tag values are untrusted
 * network input — the id is validated as 64-char lowercase hex.
 * @param {{ tags?: string[][], [key: string]: any } | null | undefined} event
 * @returns {{ communityId: string, relay: string|undefined } | undefined}
 */
export function parseConcordPointer(event) {
  if (!event || !Array.isArray(event.tags)) return undefined;
  const tag = event.tags.find((t) => Array.isArray(t) && t[0] === 'concord');
  if (!tag || !isConcordCommunityId(tag[1])) return undefined;
  return { communityId: tag[1], relay: tag[2] || undefined };
}

/**
 * Return a NEW tags array with the concord pointer set (replacing any existing one).
 * @param {string[][]} tags
 * @param {string} communityId
 * @param {string} [relay]
 * @returns {string[][]}
 */
export function withConcordPointer(tags, communityId, relay) {
  const rest = tags.filter((t) => Array.isArray(t) && t[0] !== 'concord');
  return [...rest, buildConcordPointerTag(communityId, relay)];
}

/**
 * Return a NEW tags array with every concord pointer removed (detach).
 * @param {string[][]} tags
 * @returns {string[][]}
 */
export function withoutConcordPointer(tags) {
  return tags.filter((t) => Array.isArray(t) && t[0] !== 'concord');
}
