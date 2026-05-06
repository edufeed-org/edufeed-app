/**
 * Article loading utilities for kind 30023 long-form content.
 */
import { getArticleRelays } from '$lib/helpers/relay-helper.js';
import { createCachedTimelineLoader } from './base.js';
import { applyCuratedFilter } from '$lib/services/curated-authors-service.svelte.js';
import { createCommunityContentLoader } from './community-content-loader.js';

/**
 * Factory: Create a stateful timeline loader for kind 30023 articles with automatic pagination
 * The returned loader function automatically tracks state and fetches the next chronological block on each call
 * @param {number} limit - Maximum number of articles to load per batch
 * @returns {Function} Stateful timeline loader function (call with no args, returns Observable)
 */
export function articleTimelineLoader(limit = 20) {
  const filter = applyCuratedFilter({ kinds: [30023] });
  return createCachedTimelineLoader(getArticleRelays(), filter, { limit });
}

/** Hook: Load articles for a specific community.
 *  Curated/WoT author filtering is intentionally NOT applied — content is
 *  scoped by `#h:[communityPubkey]`, which IS the curation for community views. */
export const useArticleCommunityLoader = createCommunityContentLoader([30023], getArticleRelays);
