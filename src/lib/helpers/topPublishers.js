/**
 * Per-author event counts for the calendar "top publishers" filter.
 * Pure helper — no Svelte imports.
 */

/**
 * Count events per author, sorted by count descending. Ties keep first-seen
 * order so the chip row doesn't reshuffle between renders.
 *
 * @param {Array<{pubkey?: string}>} events
 * @param {number} [limit] - Maximum number of publishers to return
 * @returns {Array<{pubkey: string, count: number}>}
 */
export function topEventPublishers(events, limit = 5) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const event of events || []) {
    const pubkey = event?.pubkey;
    if (!pubkey) continue;
    counts.set(pubkey, (counts.get(pubkey) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([pubkey, count]) => ({ pubkey, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
