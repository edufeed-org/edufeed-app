// Picks what the logged-out landing shows from what the discover loaders
// already put into the EventStore. Pure, so empty and quiet deployments are
// unit-testable (Claude Design "Landing Round 3", options 5b + 5c).
import { withoutChannelMeetings } from '$lib/helpers/calendar-timing.js';

/** A panel with fewer items reads as "empty", not as proof of life. */
export const MIN_PANEL_ITEMS = 2;

/**
 * Keeps the first item per key — callers sort newest first, so for a
 * replaceable event that is its newest version.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} key
 * @returns {T[]}
 */
function firstPerKey(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * @param {any[]} resources - formatted AMB resources (AMBResourceModel)
 * @param {number} [n]
 */
export function pickMaterials(resources, n = 3) {
  const named = resources.filter((r) => r?.name?.trim());
  const sorted = [...named].sort((a, b) => b.created_at - a.created_at);
  return firstPerKey(sorted, (r) => `${r.pubkey}:${r.identifier}`).slice(0, n);
}

/** @param {any[]} resources */
export function pickHeroMaterial(resources) {
  const all = pickMaterials(resources, Infinity);
  return all.find((r) => r.image) ?? all[0] ?? null;
}

/**
 * @param {any[]} events - transformed calendar events (CalendarEventRangeModel)
 * @param {number} nowSec
 * @param {number} [n]
 */
export function pickUpcomingEvents(events, nowSec, n = 3) {
  return withoutChannelMeetings(events)
    .filter((e) => (e.end ?? e.start) >= nowSec)
    .sort((a, b) => a.start - b.start)
    .slice(0, n);
}

/** @param {any} event @param {string} name */
const tagValue = (event, name) =>
  event.tags?.find((/** @type {string[]} */ t) => t[0] === name)?.[1];

/**
 * @param {any[]} events - raw kind 30023 events
 * @param {number} [n]
 */
export function pickArticles(events, n = 3) {
  const when = (/** @type {any} */ e) => Number(tagValue(e, 'published_at')) || e.created_at;
  const titled = events.filter((e) => tagValue(e, 'title')?.trim());
  const sorted = [...titled].sort((a, b) => when(b) - when(a));
  return firstPerKey(sorted, (e) => `${e.pubkey}:${tagValue(e, 'd') ?? ''}`).slice(0, n);
}

/**
 * @param {any[]} items
 * @param {boolean} settled - the type's loader finished (or timed out)
 * @param {number} [min]
 * @returns {'loading' | 'show' | 'hide'}
 */
export function panelState(items, settled, min = MIN_PANEL_ITEMS) {
  if (items.length >= min) return 'show';
  return settled ? 'hide' : 'loading';
}
