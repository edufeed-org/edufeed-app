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
 * Merge activity items from multiple communities into a single sorted list.
 * Deduplicates by event ID (same event h-tagged to multiple communities).
 * @param {Map<string, any[]>} perCommunityItems - Map of communityPubkey → items
 * @returns {any[]} Merged, deduplicated, sorted by created_at desc
 */
export function mergeCommunityActivity(perCommunityItems) {
  const seen = new Set();
  const merged = [];

  for (const items of perCommunityItems.values()) {
    for (const item of items) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
    }
  }

  return merged.sort((a, b) => b.created_at - a.created_at);
}
