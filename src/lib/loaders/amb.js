/**
 * AMB resource loading utilities for kind 30142 educational resources.
 */
import { getEducationalRelays } from '$lib/helpers/relay-helper.js';
import { createTimelineFeed } from './timeline-feed.js';
import { applyCuratedFilter } from '$lib/services/curated-authors-service.svelte.js';
import { createCommunityContentLoader } from './community-content-loader.js';

/**
 * The discover learning feed: kind 30142 from the educational relays,
 * curated/WoT authors applied. Relays and the filter are re-read on
 * `feed.sync()`.
 * @param {number} [pageSize=20] - Resources one "load more" adds
 * @returns {import('./timeline-feed.js').TimelineFeed}
 */
export function createAmbFeed(pageSize = 20) {
  return createTimelineFeed({
    getRelays: getEducationalRelays,
    getFilter: () => applyCuratedFilter({ kinds: [30142] }),
    pageSize
  });
}

/** Hook: Load AMB resources for a specific community.
 *  Curated/WoT author filtering is intentionally NOT applied — content is
 *  scoped by `#h:[communityPubkey]`, which IS the curation for community views. */
export const useAMBCommunityLoader = createCommunityContentLoader([30142], getEducationalRelays);
