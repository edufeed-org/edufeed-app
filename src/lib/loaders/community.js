/**
 * Community domain loaders for discovering and tracking communities.
 */
import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
import { timedPool } from './base.js';
import { applyCuratedFilter } from '$lib/services/curated-authors-service.svelte.js';

// Communities list loader (kind 10222)
// Lazy factory to ensure relays are read from runtime config at call time, not module load time
export const communikeyTimelineLoader = () => {
  const filter = applyCuratedFilter({ kinds: [10222] });
  return createTimelineLoader(timedPool, getCommunikeyRelays(), filter, { eventStore });
};
