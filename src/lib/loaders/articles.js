/**
 * Article loading utilities for kind 30023 long-form content.
 */
import { getArticleRelays } from '$lib/helpers/relay-helper.js';
import { createTimelineFeed } from './timeline-feed.js';
import { applyCuratedFilter } from '$lib/services/curated-authors-service.svelte.js';
import { createCommunityContentLoader } from './community-content-loader.js';

/**
 * The discover articles feed: kind 30023 from the article relays, curated/WoT
 * authors applied. Relays and the filter are re-read on `feed.sync()`.
 * @param {number} [pageSize=20] - Articles one "load more" adds
 * @returns {import('./timeline-feed.js').TimelineFeed}
 */
export function createArticleFeed(pageSize = 20) {
  return createTimelineFeed({
    getRelays: getArticleRelays,
    getFilter: () => applyCuratedFilter({ kinds: [30023] }),
    pageSize
  });
}

/** Hook: Load articles for a specific community.
 *  Curated/WoT author filtering is intentionally NOT applied — content is
 *  scoped by `#h:[communityPubkey]`, which IS the curation for community views. */
export const useArticleCommunityLoader = createCommunityContentLoader([30023], getArticleRelays);
