/**
 * Pure helpers for community form default/override management.
 *
 * `formRef` per content type is the sole source of truth.
 * `defaultFormRef` is a UI convenience — the most common formRef among enabled gated types.
 */

import { parseCommunityContentTypes, sectionIsGated } from './communityRelays.js';

/**
 * @typedef {Object} ContentTypeConfig
 * @property {string} name
 * @property {boolean} enabled
 * @property {string} formRef
 * @property {{read: string|null, write: string|null}} badges
 * @property {string[]} relays
 */

/**
 * Get the community-wide form ref if all gated sections share the same form.
 * @param {{ getFormRef: (name: string) => string|null } | null} profileAccess
 * @param {any} communityEvent - kind 10222
 * @returns {string | null}
 */
export function getCommunityWideFormRef(profileAccess, communityEvent) {
  if (!profileAccess || !communityEvent) return null;

  const sections = parseCommunityContentTypes(communityEvent);
  const gatedSections = sections.filter((s) => sectionIsGated(s));
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
