// src/lib/groups/section-access.js
//
// Surgical edit of ONE content section's access tier on a live kind-10222
// tag array (docs/nips/communikey-groups.md `access`). Never rebuilds the
// event — sibling sections, pointer tags, and unknown tags pass through
// verbatim, which is what keeps settings edits free of the
// preservePointerTags/opts double-tag hazard.

/** @typedef {{tier:'all'}|{tier:'members'}|{tier:'role', role?: string}} AccessTier */

/**
 * @param {string[][]} tags
 * @param {string} sectionName
 * @param {AccessTier} access
 * @returns {string[][]} a new array; unchanged copy when the section is absent
 */
export function withSectionAccess(tags, sectionName, access) {
  const start = tags.findIndex(
    (tag) => Array.isArray(tag) && tag[0] === 'content' && tag[1] === sectionName
  );
  if (start === -1) return [...tags];
  let end = tags.length;
  for (let i = start + 1; i < tags.length; i++) {
    if (Array.isArray(tags[i]) && tags[i][0] === 'content') {
      end = i;
      break;
    }
  }
  const section = tags
    .slice(start, end)
    .filter((tag) => !(Array.isArray(tag) && tag[0] === 'access'));
  const role = access.tier === 'role' ? (access.role ?? '').trim() : '';
  if (access.tier === 'members') {
    section.splice(1, 0, ['access', 'members']);
  } else if (access.tier === 'role' && role) {
    section.splice(1, 0, ['access', 'role', role]);
  }
  return [...tags.slice(0, start), ...section, ...tags.slice(end)];
}
