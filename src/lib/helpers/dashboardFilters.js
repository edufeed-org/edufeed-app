import { getEventStartTimestamp } from '$lib/helpers/calendar.js';

/**
 * Filter and sort upcoming calendar events (future only, by start time, max 4).
 * @param {any[]} items
 * @param {number} nowTs - Current unix timestamp in seconds
 * @returns {any[]}
 */
export function filterUpcomingEvents(items, nowTs) {
  return [...items]
    .filter((e) => e.kind === 31922 || e.kind === 31923)
    .map((e) => ({ event: e, start: getEventStartTimestamp(e) }))
    .filter((e) => e.start > nowTs)
    .sort((a, b) => a.start - b.start)
    .slice(0, 4)
    .map((e) => e.event);
}

/**
 * Get most recent activity items sorted by created_at desc, max 8.
 * @param {any[]} items
 * @returns {any[]}
 */
export function filterRecentActivity(items) {
  return [...items].sort((a, b) => b.created_at - a.created_at).slice(0, 8);
}
