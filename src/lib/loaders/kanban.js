/**
 * Kanban board loading utilities for kind 30301 board definitions.
 */
import { getKanbanRelays } from '$lib/helpers/relay-helper.js';
import { createTimelineFeed } from './timeline-feed.js';
import { applyCuratedFilter } from '$lib/services/curated-authors-service.svelte.js';

/**
 * The discover boards feed: kind 30301 from the kanban relays, curated/WoT
 * authors applied. Relays and the filter are re-read on `feed.sync()`.
 * @param {number} [pageSize=20] - Boards one "load more" adds
 * @returns {import('./timeline-feed.js').TimelineFeed}
 */
export function createKanbanFeed(pageSize = 20) {
  return createTimelineFeed({
    getRelays: getKanbanRelays,
    getFilter: () => applyCuratedFilter({ kinds: [30301] }),
    pageSize
  });
}
