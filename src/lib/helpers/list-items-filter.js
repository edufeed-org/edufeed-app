/**
 * Search and type filter for the items of a NIP-51 list (issue a0838dc9).
 * Rows carry a precomputed `text` (title, description, author name) so the
 * filter stays a pure string match.
 */
import { getFeedCardData } from '$lib/helpers/feedCardData.js';

/**
 * @template {{ typeKey: string, text: string }} T
 * @param {T[]} rows
 * @param {{ query: string, type: string }} filter - type '' = all types
 * @returns {T[]}
 */
export function filterListItems(rows, { query, type }) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0 && !type) return rows;
  return rows.filter((row) => {
    if (type && row.typeKey !== type) return false;
    const text = row.text.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/**
 * Each item type once, in order of first appearance.
 * @param {{ typeKey: string }[]} rows
 * @returns {string[]}
 */
export function listItemTypes(rows) {
  return [...new Set(rows.map((r) => r.typeKey).filter(Boolean))];
}

/**
 * Filter rows for a list's resolved item events: the feed-card data each view
 * renders anyway, plus the searchable text (title, subtitle, description,
 * author name).
 * @param {import('nostr-tools').NostrEvent[]} events
 * @param {Map<string, any>} profiles - pubkey → profile (useProfileMap)
 */
export function buildListItemRows(events, profiles) {
  return events.map((itemEvent) => {
    const cardData = getFeedCardData(itemEvent);
    const author = profiles.get(itemEvent.pubkey);
    return {
      itemEvent,
      cardData,
      typeKey: cardData.typeKey || '',
      text: [
        cardData.title,
        cardData.subtitle,
        cardData.description,
        author?.displayName,
        author?.name
      ]
        .filter(Boolean)
        .join(' ')
    };
  });
}
