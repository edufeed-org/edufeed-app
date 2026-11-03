/**
 * Per-device memory of the last opened section of each community, plus the
 * visit time — localStorage only, no relay traffic.
 *
 * Consumers: the phone Communities list (row target + "neu" badge, see
 * `helpers/community-row-target.js`). Explicit links elsewhere keep their
 * meaning; only that list resumes where you left off.
 *
 * Shape: `{ [communityPubkeyHex]: { view, at } }` under `LAST_VIEW_KEY`.
 * `view` is a content section (never settings/members); `at` is the last
 * visit in unix seconds. Entries expire after 90 days and the map is capped
 * at 200 communities (oldest dropped). Every storage access is guarded —
 * a private-mode browser must behave as if nothing were remembered.
 */
import { VALID_CONTENT_VIEWS } from '$lib/helpers/contentTypes.js';

export const LAST_VIEW_KEY = 'edufeed:community-last-view';
export const LAST_VIEW_TTL_SECONDS = 90 * 86400;
export const LAST_VIEW_MAX = 200;

const NOT_REMEMBERED = new Set(['settings', 'members']);

/**
 * @param {string} view
 * @returns {boolean}
 */
export function isRememberableView(view) {
  return VALID_CONTENT_VIEWS.has(view) && !NOT_REMEMBERED.has(view);
}

/**
 * @param {Storage | undefined} storage
 * @returns {Record<string, { view: string, at: number }>}
 */
function readMap(storage) {
  try {
    const raw = storage?.getItem(LAST_VIEW_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} pubkey
 * @param {string} view
 * @param {number} now - unix seconds
 * @param {Storage | undefined} [storage]
 */
export function rememberCommunityView(pubkey, view, now, storage = globalThis.localStorage) {
  try {
    const map = readMap(storage);
    const previous = map[pubkey];
    const nextView = isRememberableView(view) ? view : (previous?.view ?? 'home');
    map[pubkey] = { view: nextView, at: now };

    for (const [key, entry] of Object.entries(map)) {
      if (!entry || typeof entry.at !== 'number' || now - entry.at > LAST_VIEW_TTL_SECONDS) {
        delete map[key];
      }
    }
    const keys = Object.keys(map);
    if (keys.length > LAST_VIEW_MAX) {
      keys
        .sort((a, b) => map[a].at - map[b].at)
        .slice(0, keys.length - LAST_VIEW_MAX)
        .forEach((key) => delete map[key]);
    }
    storage?.setItem(LAST_VIEW_KEY, JSON.stringify(map));
  } catch {
    // private mode / quota: behave as if nothing were remembered
  }
}

/**
 * @param {string} pubkey
 * @param {number} now - unix seconds
 * @param {Storage | undefined} [storage]
 * @returns {{ view: string, at: number } | null}
 */
export function readCommunityView(pubkey, now, storage = globalThis.localStorage) {
  const entry = readMap(storage)[pubkey];
  if (!entry || typeof entry.at !== 'number' || typeof entry.view !== 'string') return null;
  if (now - entry.at > LAST_VIEW_TTL_SECONDS) return null;
  return { view: entry.view, at: entry.at };
}
