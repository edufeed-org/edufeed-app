/**
 * Per-author event counts for the calendar "top publishers" filter.
 * Pure helper — no Svelte imports.
 */

/**
 * Apply the publisher quick-filter selection to an event list. A non-empty
 * selection wins: only the selected authors' events show (the hidden list is
 * preserved but ignored). Otherwise hidden authors are removed. Returns the
 * input array unchanged when nothing is selected or hidden.
 *
 * @template {{pubkey?: string}} T
 * @param {T[]} events
 * @param {{selected: string[], hidden: string[]}} selection
 * @returns {T[]}
 */
export function filterEventsByPublisherSelection(events, { selected, hidden }) {
  if (selected.length > 0) return events.filter((event) => selected.includes(event.pubkey ?? ''));
  if (hidden.length > 0) return events.filter((event) => !hidden.includes(event.pubkey ?? ''));
  return events;
}

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
