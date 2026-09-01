//
// Type transitions per docs/nips/communikey-groups.md: open ↔ moderated as
// surgical tag edits on the live 10222 (closed never transitions). Flip to
// moderated also sunsets legacy per-section ACL (the spec's MUST-NOT-write
// tags) so mixed legacy+roster state cannot exist.
import {
  buildMembershipTag,
  withoutMembershipPointer,
  withoutApplicationRef
} from './community-membership.js';

const isTag = (/** @type {unknown} */ tag) => Array.isArray(tag);

/**
 * Remove legacy per-section gating: profile-list a-tags and 'form'-marked
 * preferred-form a-tags. Badge (30009) and unmarked 30168 a-tags stay.
 * @param {string[][]} tags
 * @returns {string[][]}
 */
export function stripLegacySectionAcl(tags) {
  return tags.filter((tag) => {
    if (!isTag(tag) || tag[0] !== 'a' || typeof tag[1] !== 'string') return true;
    if (tag[1].startsWith('30000:')) return false;
    if (tag[1].startsWith('30168:') && tag[3] === 'form') return false;
    return true;
  });
}

/**
 * @param {string[][]} tags
 * @param {{id: string, relay: string}} rootPointer
 * @returns {string[][]}
 */
export function buildFlipToModeratedTags(tags, rootPointer) {
  const cleaned = withoutMembershipPointer(stripLegacySectionAcl(tags)).filter(
    (tag) => !(isTag(tag) && tag[0] === 'concord')
  );
  const membershipTag = buildMembershipTag(rootPointer);
  const anchor = cleaned.findIndex(
    (tag) => isTag(tag) && (tag[0] === 'content' || tag[0] === 'strict')
  );
  if (anchor === -1) return [...cleaned, membershipTag];
  return [...cleaned.slice(0, anchor), membershipTag, ...cleaned.slice(anchor)];
}

/**
 * @param {string[][]} tags
 * @returns {string[][]}
 */
export function buildFlipToOpenTags(tags) {
  return stripLegacySectionAcl(withoutApplicationRef(withoutMembershipPointer(tags))).filter(
    (tag) => !(isTag(tag) && (tag[0] === 'access' || tag[0] === 'group' || tag[0] === 'concord'))
  );
}

/**
 * Unsigned 10222 replacement carrying the given tags. created_at bump rule:
 * strictly newer than the source event, so relays replace rather than drop.
 * @param {{kind?: number, content?: string, created_at?: number, tags?: string[][]}} sourceEvent
 * @param {string[][]} tags
 * @returns {{kind: number, content: string, tags: string[][], created_at: number}}
 */
export function communityUpdateTemplate(sourceEvent, tags) {
  return {
    kind: 10222,
    content: sourceEvent.content ?? '',
    tags,
    created_at: Math.max(Math.floor(Date.now() / 1000), (sourceEvent.created_at ?? 0) + 1)
  };
}
