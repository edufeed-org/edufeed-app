/**
 * AMB resource loading utilities for kind 30142 educational resources.
 */
import { getEducationalRelays } from '$lib/helpers/relay-helper.js';
import { createCachedTimelineLoader } from './base.js';
import { applyCuratedFilter } from '$lib/services/curated-authors-service.svelte.js';
import { createCommunityContentLoader } from './community-content-loader.js';

/**
 * Factory: Create a stateful timeline loader for kind 30142 AMB resources with automatic pagination
 * The returned loader function automatically tracks state and fetches the next chronological block on each call
 * @param {number} limit - Maximum number of resources to load per batch
 * @returns {Function} Stateful timeline loader function (call with no args, returns Observable)
 */
export function ambTimelineLoader(limit = 20) {
  const filter = applyCuratedFilter({ kinds: [30142] });
  return createCachedTimelineLoader(getEducationalRelays(), filter, { limit });
}

/** Hook: Load AMB resources for a specific community.
 *  Curated/WoT author filtering is intentionally NOT applied — content is
 *  scoped by `#h:[communityPubkey]`, which IS the curation for community views. */
export const useAMBCommunityLoader = createCommunityContentLoader([30142], getEducationalRelays);
