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
 * The first n items, one per author before any author gets a second: a busy
 * source must not fill a whole panel. Order within each round is kept.
 * @template {{ pubkey: string }} T
 * @param {T[]} sorted
 * @param {number} n
 * @returns {T[]}
 */
function spreadAuthors(sorted, n) {
  const first = firstPerKey(sorted, (item) => item.pubkey);
  if (first.length >= n) return first.slice(0, n);
  const rest = sorted.filter((item) => !first.includes(item));
  return [...first, ...rest].slice(0, n);
}

/**
 * @param {any[]} resources - formatted AMB resources (AMBResourceModel)
 * @param {number} [n]
 */
export function pickMaterials(resources, n = 3) {
  const named = resources.filter((r) => r?.name?.trim());
  const sorted = [...named].sort((a, b) => b.created_at - a.created_at);
  const unique = firstPerKey(sorted, (r) => `${r.pubkey}:${r.identifier}`);
  // A card without a preview reads as broken next to ones with one: imageless
  // items only fill up a panel that has too few with an image.
  return [
    ...spreadAuthors(
      unique.filter((r) => r.image),
      n
    ),
    ...spreadAuthors(
      unique.filter((r) => !r.image),
      n
    )
  ].slice(0, n);
}

/** @param {any[]} resources */
export function pickHeroMaterial(resources) {
  const all = pickMaterials(resources, Infinity);
  return all.find((r) => r.image) ?? all[0] ?? null;
}

/**
 * @param {any[]} events - transformed calendar events (CalendarEventRangeModel)
 * @param {number} nowSec - now; the cut-off is the start of the viewer's day
 * @param {number} [n]
 */
export function pickUpcomingEvents(events, nowSec, n = 3) {
  // "Next" Fortbildungen: starting today or later, in the viewer's day. A
  // course that started weeks ago and still runs would show a past date.
  const now = new Date(nowSec * 1000);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const startOfToday = Math.floor(today.getTime() / 1000);
  // All-day events (31922) carry a calendar date stored as UTC midnight:
  // compare dates, not instants, or west of UTC today's event looks past.
  const pad = (/** @type {number} */ x) => String(x).padStart(2, '0');
  const localDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  /** @param {any} e */
  const upcoming = (e) =>
    e.kind === 31922
      ? new Date(e.start * 1000).toISOString().slice(0, 10) >= localDate
      : e.start >= startOfToday;
  return withoutChannelMeetings(events)
    .filter(upcoming)
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
  return spreadAuthors(
    firstPerKey(sorted, (e) => `${e.pubkey}:${tagValue(e, 'd') ?? ''}`),
    n
  );
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

/**
 * Communities for the landing wall and hero card: only those on the
 * showcase lists, only those with a named kind 0 profile (an unnamed one
 * renders as "Unknown User"), newest definition first, one per community.
 * @param {any[]} events - kind 10222 community definitions
 * @param {Map<string, any>} profiles - pubkey → kind 0 profile content
 * @param {string[]} sources - pubkeys from the showcase lists
 * @param {number} [n]
 * @returns {{ pubkey: string, name: string, about: string, picture: string }[]}
 */
export function landingCommunities(events, profiles, sources, n = 11) {
  const allowed = new Set(sources);
  const listed = events.filter((e) => allowed.has(e.pubkey));
  const sorted = [...listed].sort((a, b) => b.created_at - a.created_at);
  return firstPerKey(sorted, (e) => e.pubkey)
    .map((e) => {
      const p = profiles.get(e.pubkey);
      const name = (p?.display_name?.trim() || p?.name?.trim() || '').trim();
      return { pubkey: e.pubkey, name, about: p?.about || '', picture: p?.picture || '' };
    })
    .filter((c) => c.name)
    .slice(0, n);
}

/**
 * Whether the hero should still hold its card column: some enabled source
 * has not answered yet. A disabled source never holds it.
 * @param {Record<string, boolean>} enabled
 * @param {Record<string, boolean>} settled
 */
export function heroPending(enabled, settled) {
  return Object.keys(enabled).some((type) => enabled[type] && !settled[type]);
}

/**
 * Relay filters for the landing showcase: content BY a listed account, or
 * h-tagged INTO a listed community (Communikey targeting). No sources, no
 * filters — the landing must never fall back to arbitrary network content.
 * With `perAuthor`, each account is asked for its own newest items: under a
 * shared limit one busy source fills the whole window and the others are
 * never fetched, so one-item-per-author picking has nothing to pick from.
 * @param {number[]} kinds
 * @param {string[]} sources - pubkeys from the showcase lists
 * @param {number} limit
 * @param {number} [perAuthor]
 */
export function showcaseFilters(kinds, sources, limit, perAuthor) {
  if (sources.length === 0) return [];
  const byAuthor = perAuthor
    ? sources.map((pubkey) => ({ kinds, authors: [pubkey], limit: perAuthor }))
    : [{ kinds, authors: sources, limit }];
  return [...byAuthor, { kinds, '#h': sources, limit }];
}
