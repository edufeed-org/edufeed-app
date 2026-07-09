/**
 * Ranking helpers for the community home feed.
 *
 * Shared items resolve to the ORIGINAL event, which may be old — ranking by
 * its created_at buries a fresh share below the feed's top-N cut. Activity
 * ranking therefore uses the later of publish time and share time, and
 * upcoming-event selection works on the full item set, not the capped feed.
 */

/**
 * When an item was last "active": its own created_at or the newest share.
 *
 * @param {{created_at?: number, _sharedAt?: number}} item
 * @returns {number}
 */
export function activityTimestamp(item) {
  return Math.max(item.created_at || 0, item._sharedAt || 0);
}

/**
 * Merge item lists, dedupe by id, rank by activity time.
 *
 * @param {any[][]} lists
 * @param {number} limit - cap for the feed view
 * @returns {{top: any[], all: any[]}} top = capped feed items, all = full ranked set
 */
export function mergeFeedItems(lists, limit) {
  const seen = new Set();
  const all = lists
    .flat()
    .filter((e) => {
      if (!e || seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    })
    .sort((a, b) => activityTimestamp(b) - activityTimestamp(a));
  return { top: all.slice(0, limit), all };
}

/**
 * Future calendar events (31922/31923) from the FULL item set, by start time.
 *
 * @param {any[]} items
 * @param {(item: any) => number} getStart - start-timestamp accessor
 * @param {number} now - unix seconds
 * @param {number} limit
 * @returns {any[]}
 */
export function selectUpcomingEvents(items, getStart, now, limit) {
  return items
    .filter((e) => (e.kind === 31922 || e.kind === 31923) && getStart(e) > now)
    .sort((a, b) => getStart(a) - getStart(b))
    .slice(0, limit);
}
