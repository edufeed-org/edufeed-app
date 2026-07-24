// Pure helpers for the "Private areas" sidebar/route (Concord follow-up 1):
// which Concord memberships are NOT anchored to a followed Communikey
// community (joined via another client like Armada, or via a bare invite
// link with no 10222 pointer on this platform). No package imports — safe
// for node-env unit tests and any SSR-adjacent call site.
import { parseConcordPointer, isConcordCommunityId } from './pointer.js';

/**
 * @typedef {{communityId: string, name: string, dissolved: boolean, iconPointer: import('./blob-media.js').BlobPointerLike | undefined}} UnlinkedArea
 */

/**
 * Concord community ids that a followed Communikey community's kind 10222
 * event already points at, via the `concord` pointer tag. Pure: only
 * reflects 10222 events the caller actually passed in — it does not fetch
 * anything itself. The caller, `useUnlinkedConcordAreas` (unlinked-areas.svelte.js),
 * proactively fetches each joined pubkey's 10222 (bounded, once per session)
 * so this function's input is populated within a relay round-trip rather
 * than whenever something else happens to load it.
 * @param {any[] | null | undefined} communikeyEvents kind 10222 events
 * @returns {Set<string>}
 */
export function linkedConcordIds(communikeyEvents) {
  const ids = new Set();
  for (const event of communikeyEvents ?? []) {
    const pointer = parseConcordPointer(event);
    if (pointer) ids.add(pointer.communityId);
  }
  return ids;
}

/**
 * Display name fallback chain for one CommunityState (client.svelte.js's
 * `communities` array): metadata (CORD community-profile plane) > material
 * (the locally-known name at founding/join time) > a short id fragment.
 * Shared by {@link unlinkedConcordAreas} and the standalone `/private/<id>`
 * page header, which needs the same name for a community that may not even
 * be "unlinked" in the caller's sense (e.g. the owner opening their own
 * area's raw-id link).
 * @param {any} communityState one entry of getConcordState().communities
 * @returns {string}
 */
export function concordAreaDisplayName(communityState) {
  const communityId = communityState?.material?.community_id ?? '';
  return (
    communityState?.metadata?.name || communityState?.material?.name || communityId.slice(0, 12)
  );
}

/**
 * Concord memberships with no corresponding linked pointer — i.e. private
 * areas only reachable by their raw community id, not through a Communikey
 * community page. Dissolved areas are included (not filtered out) so the
 * standalone page can still show their tombstone state; hiding them would
 * strand chat history the user can otherwise still read.
 * @param {{communities: any[] | null | undefined, linkedIds: Set<string>}} args
 * @returns {UnlinkedArea[]} sorted by name
 */
export function unlinkedConcordAreas({ communities, linkedIds }) {
  /** @type {Map<string, UnlinkedArea>} */
  const byId = new Map();
  for (const state of communities ?? []) {
    const communityId = state?.material?.community_id;
    if (!communityId || linkedIds.has(communityId) || byId.has(communityId)) continue;
    byId.set(communityId, {
      communityId,
      name: concordAreaDisplayName(state),
      dissolved: !!state.dissolved,
      iconPointer: state.metadata?.icon
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** @typedef {'disabled'|'invalid'|'login'|'render'} PrivateAreaGate */

/**
 * Gate decision for the standalone `/private/<id>` route, extracted from the
 * page's cascading `{#if}` so the ordering is unit-testable without mounting
 * a Svelte page (Concord follow-up 1 review, Task 2). Order matters and is
 * deliberate: the flag gate beats id validation (no point validating an id
 * for a feature that's off), id validation beats the login gate (a
 * malformed id should never prompt a login), and login gates the final
 * render.
 * @param {{enabled: boolean, id: string | null | undefined, loggedIn: boolean}} args
 * @returns {PrivateAreaGate}
 */
export function privateAreaGate({ enabled, id, loggedIn }) {
  if (!enabled) return 'disabled';
  if (!isConcordCommunityId(id)) return 'invalid';
  if (!loggedIn) return 'login';
  return 'render';
}

/**
 * Fixed palette for the sidebar area badge background (Armada-parity follow-
 * up, sidebar badges task). Every entry is a DaisyUI semantic pair (bg +
 * matching content color) so the badge always follows the active theme's
 * tokens — never hardcode OKLCH literals here, per CLAUDE.md's theming
 * rules. `areaColorClass` picks one deterministically from this list.
 */
export const AREA_BADGE_COLOR_CLASSES = [
  'bg-primary text-primary-content',
  'bg-secondary text-secondary-content',
  'bg-accent text-accent-content',
  'bg-info text-info-content',
  'bg-success text-success-content',
  'bg-warning text-warning-content',
  'bg-error text-error-content',
  'bg-neutral text-neutral-content'
];

/** Words separated by whitespace OR a hyphen — "edufeed-armada" abbreviates
 *  like a two-word name ("EA"), matching Armada's badge convention. */
const AREA_NAME_WORD_SPLIT = /[\s-]+/;

/**
 * Abbreviate a Concord area name to 1-2 characters for the sidebar badge
 * (Armada shows these instead of a bare lock icon for unlinked areas).
 *
 * - 2+ words (or a hyphenated single word, split the same way): first letter
 *   of the first two words, uppercased — "Soapbox Community" -> "SC",
 *   "edufeed-armada" -> "EA".
 * - exactly 1 word: its first two letters, uppercased — "Concord" -> "CO".
 *   A single-character word returns just that character uppercased.
 * - empty/whitespace-only/missing name: "?" (the tooltip still carries the
 *   full name, so this is only the glyph, never the only signal).
 *
 * @param {string | null | undefined} name
 * @returns {string}
 */
export function areaAbbreviation(name) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  const words = trimmed.split(AREA_NAME_WORD_SPLIT).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return words[0].slice(0, 2).toUpperCase();
}

/**
 * Deterministically pick a background/content class pair from
 * {@link AREA_BADGE_COLOR_CLASSES} for a given Concord communityId, so the
 * same area always renders the same badge color across sessions/devices.
 * Pure string hash (djb2-ish) — no crypto needed, just a stable spread
 * across the fixed palette.
 *
 * @param {string | null | undefined} communityId
 * @returns {string} one of {@link AREA_BADGE_COLOR_CLASSES}
 */
export function areaColorClass(communityId) {
  const s = communityId ?? '';
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (Math.imul(hash, 31) + s.charCodeAt(i)) >>> 0;
  }
  return AREA_BADGE_COLOR_CLASSES[hash % AREA_BADGE_COLOR_CLASSES.length];
}
