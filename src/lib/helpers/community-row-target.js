/**
 * Where a row of the phone Communities list lands, and whether it is "neu".
 *
 * 1. The newest item is newer than this device's last visit and its kind
 *    maps to a section the community offers → that section.
 * 2. Else the remembered section (`stores/community-last-view.js`), if the
 *    community offers it.
 * 3. Else `home`.
 *
 * No last visit on this device (fresh install, expired entry) means nothing
 * counts as new: "new since last visit" needs a visit to compare against.
 */
import { kindToContentType } from '$lib/helpers/contentTypes.js';

/**
 * @param {any[]} items
 * @returns {any | null}
 */
export function newestCommunityItem(items) {
  let newest = null;
  for (const item of items ?? []) {
    if (!newest || item.created_at > newest.created_at) newest = item;
  }
  return newest;
}

/**
 * @param {any | null} newest
 * @param {number | null} lastVisit - unix seconds of the last visit, null if none
 * @returns {boolean}
 */
export function communityRowIsNew(newest, lastVisit) {
  return !!newest && lastVisit !== null && lastVisit !== undefined && newest.created_at > lastVisit;
}

/**
 * @param {{ newest: any | null, lastVisit: number | null, remembered: string | null, tabs: string[] }} args
 * @returns {string} section id for `?view=` (`'home'` for the community root)
 */
export function communityRowTarget({ newest, lastVisit, remembered, tabs }) {
  const offered = new Set(tabs ?? []);
  if (communityRowIsNew(newest, lastVisit)) {
    const section = kindToContentType(newest.kind);
    if (section && offered.has(section)) return section;
  }
  if (remembered && offered.has(remembered)) return remembered;
  return 'home';
}
