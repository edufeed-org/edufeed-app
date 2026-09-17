/**
 * Per-relay rank merging for NIP-50 search results.
 *
 * The AMB relay orders each response by relevance, but its scores are
 * relative to that one response — not comparable across relays or queries.
 * Its README therefore asks clients that query several relays to merge by
 * per-relay rank and dedupe by address. This module is that merge, kept
 * pure so it can be unit-tested and reused by any search surface.
 */

/**
 * @typedef {import('nostr-tools').Event} NostrEvent
 */

/**
 * Stable key for a search result: `kind:pubkey:d` for addressable events
 * (the same resource can arrive as different versions from different
 * relays), the event id otherwise.
 *
 * Deliberately not `getReplaceableAddress()` from applesauce — that caches
 * on the event and trips Svelte's `state_unsafe_mutation` inside `$derived`.
 *
 * @param {NostrEvent} event
 * @returns {string}
 */
export function searchRankKey(event) {
  if (event.kind >= 30000 && event.kind < 40000) {
    const d = event.tags?.find((t) => t[0] === 'd')?.[1];
    if (d !== undefined) return `${event.kind}:${event.pubkey}:${d}`;
  }
  return event.id;
}

/**
 * Merge per-relay result lists by rank: rank 1 of every relay first, then
 * rank 2, and so on. Within the same rank the relay order (as configured)
 * wins. A key seen on several relays is emitted once, at its best rank,
 * carrying the newest version of the event.
 *
 * @param {NostrEvent[][]} perRelayLists - One relevance-ordered list per relay, in relay order
 * @returns {NostrEvent[]} Merged, deduplicated list in relevance order
 */
export function mergeByRelayRank(perRelayLists) {
  /** @type {Map<string, { event: NostrEvent, rank: number, relayIndex: number }>} */
  const best = new Map();

  perRelayLists.forEach((list, relayIndex) => {
    list.forEach((event, i) => {
      const rank = i + 1;
      const key = searchRankKey(event);
      const existing = best.get(key);
      if (!existing) {
        best.set(key, { event, rank, relayIndex });
        return;
      }
      const betterRank =
        rank < existing.rank || (rank === existing.rank && relayIndex < existing.relayIndex);
      const newerEvent = event.created_at > existing.event.created_at;
      best.set(key, {
        event: newerEvent ? event : existing.event,
        rank: betterRank ? rank : existing.rank,
        relayIndex: betterRank ? relayIndex : existing.relayIndex
      });
    });
  });

  return [...best.values()]
    .sort((a, b) => a.rank - b.rank || a.relayIndex - b.relayIndex)
    .map((entry) => entry.event);
}

/**
 * Position lookup for the merged order: key → 0-based index.
 * Use with {@link searchRankKey} to sort already-formatted items.
 *
 * @param {NostrEvent[][]} perRelayLists
 * @returns {Map<string, number>}
 */
export function buildRankIndex(perRelayLists) {
  const index = new Map();
  mergeByRelayRank(perRelayLists).forEach((event, i) => index.set(searchRankKey(event), i));
  return index;
}
