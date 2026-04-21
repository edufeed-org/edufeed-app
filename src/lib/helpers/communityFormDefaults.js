/**
 * Pure helpers for community form default/override management.
 *
 * `formRef` per content type is the sole source of truth.
 * `defaultFormRef` is a UI convenience — the most common formRef among enabled gated types.
 */

import { parseCommunityContentTypes } from './communityRelays.js';

/**
 * @typedef {Object} ContentTypeConfig
 * @property {string} name
 * @property {boolean} enabled
 * @property {string} formRef
 * @property {{read: string|null, write: string|null}} badges
 * @property {string[]} relays
 */

/**
 * Derive the default formRef from content types.
 * Returns the most common non-empty formRef among enabled types.
 * Ties are broken by first key in iteration order.
 * @param {Record<string, ContentTypeConfig>} contentTypes
 * @returns {string}
 */
export function deriveDefaultFormRef(contentTypes) {
  /** @type {Record<string, number>} */
  const counts = {};
  /** @type {Record<string, string>} first key seen per formRef */
  const firstKey = {};

  for (const [key, ct] of Object.entries(contentTypes)) {
    if (!ct.enabled || !ct.formRef) continue;
    counts[ct.formRef] = (counts[ct.formRef] || 0) + 1;
    if (!(ct.formRef in firstKey)) firstKey[ct.formRef] = key;
  }

  if (Object.keys(counts).length === 0) return '';

  // Sort by count descending, then by first-seen key for tie-breaking
  const keys = Object.keys(contentTypes);
  const sorted = Object.entries(counts).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return keys.indexOf(firstKey[a[0]]) - keys.indexOf(firstKey[b[0]]);
  });

  return sorted[0][0];
}

/**
 * Apply a default formRef change: update all enabled types whose formRef
 * matches oldDefault to newDefault. Returns a new object (no mutation).
 * @param {Record<string, ContentTypeConfig>} contentTypes
 * @param {string} oldDefault
 * @param {string} newDefault
 * @returns {Record<string, ContentTypeConfig>}
 */
export function applyDefaultFormRef(contentTypes, oldDefault, newDefault) {
  /** @type {Record<string, ContentTypeConfig>} */
  const result = {};
  for (const [key, ct] of Object.entries(contentTypes)) {
    if (ct.enabled && ct.formRef === oldDefault) {
      result[key] = { ...ct, formRef: newDefault };
    } else {
      result[key] = { ...ct };
    }
  }
  return result;
}

/**
 * Get the community-wide form ref if all gated sections share the same form.
 * @param {{ getFormRef: (name: string) => string|null } | null} profileAccess
 * @param {any} communityEvent - kind 10222
 * @returns {string | null}
 */
export function getCommunityWideFormRef(profileAccess, communityEvent) {
  if (!profileAccess || !communityEvent) return null;

  const sections = parseCommunityContentTypes(communityEvent);
  const gatedSections = sections.filter((s) => s.profileList);
  if (gatedSections.length === 0) return null;

  /** @type {string | null} */
  let sharedRef = null;

  for (const section of gatedSections) {
    const formRef = profileAccess.getFormRef(section.name);
    if (!formRef) return null;
    if (sharedRef === null) {
      sharedRef = formRef;
    } else if (sharedRef !== formRef) {
      return null;
    }
  }

  return sharedRef;
}
