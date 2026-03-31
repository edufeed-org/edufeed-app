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

/**
 * Load form templates (kind 30168) for given pubkey(s).
 * @param {string | string[]} pubkeys
 */
export const formTemplateLoader = (pubkeys) =>
  createTimelineLoader(
    timedPool,
    getCommunikeyRelays(),
    { kinds: [30168], authors: Array.isArray(pubkeys) ? pubkeys : [pubkeys] },
    { eventStore }
  );

/**
 * Load form requests (kind 1070) sent to a specific user.
 * @param {string} recipientPubkey
 */
export const formRequestLoader = (recipientPubkey) =>
  createTimelineLoader(
    timedPool,
    getCommunikeyRelays(),
    { kinds: [1070], '#p': [recipientPubkey] },
    { eventStore }
  );

/**
 * Load form responses (kind 1069) for a specific form.
 * @param {string} formAddress - Form coordinate: "30168:pubkey:d-tag"
 * @param {string} creatorPubkey - Form creator's pubkey (for #p filter efficiency)
 */
export const formResponseLoader = (formAddress, creatorPubkey) =>
  createTimelineLoader(
    timedPool,
    getCommunikeyRelays(),
    { kinds: [1069], '#a': [formAddress], '#p': [creatorPubkey] },
    { eventStore }
  );
