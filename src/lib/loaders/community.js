/**
 * Community domain loaders for discovering and tracking communities.
 */
import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
import { createCachedTimelineLoader } from './base.js';
import { applyCuratedFilter } from '$lib/services/curated-authors-service.svelte.js';

// Communities list loader (kind 10222)
// Lazy factory to ensure relays are read from runtime config at call time, not module load time
export const communikeyTimelineLoader = () => {
  const filter = applyCuratedFilter({ kinds: [10222] });
  return createCachedTimelineLoader(getCommunikeyRelays(), filter);
};

/**
 * Load form templates (kind 30168) for given pubkey(s).
 * @param {string | string[]} pubkeys
 */
export const formTemplateLoader = (pubkeys) =>
  createCachedTimelineLoader(getCommunikeyRelays(), {
    kinds: [30168],
    authors: Array.isArray(pubkeys) ? pubkeys : [pubkeys]
  });

/**
 * Load form requests (kind 1070) sent to a specific user.
 * @param {string} recipientPubkey
 */
export const formRequestLoader = (recipientPubkey) =>
  createCachedTimelineLoader(getCommunikeyRelays(), {
    kinds: [1070],
    '#p': [recipientPubkey]
  });

/**
 * Load form responses (kind 1069) for a specific form.
 * @param {string} formAddress - Form coordinate: "30168:pubkey:d-tag"
 * @param {string} creatorPubkey - Form creator's pubkey (for #p filter efficiency)
 */
export const formResponseLoader = (formAddress, creatorPubkey) =>
  createCachedTimelineLoader(getCommunikeyRelays(), {
    kinds: [1069],
    '#a': [formAddress],
    '#p': [creatorPubkey]
  });
