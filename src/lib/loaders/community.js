/**
 * Community domain loaders for discovering and tracking communities.
 * All one-shots: cache + communikey relays into the EventStore.
 */
import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
import { fetchEvents } from './base.js';
import { applyCuratedFilter } from '$lib/services/curated-authors-service.svelte.js';

/**
 * Communities list (kind 10222). Relays are read at call time, not module
 * load time, so runtime config and user overrides apply.
 * @returns {import('rxjs').Observable<any>}
 */
export const communikeyTimelineLoader = () =>
  fetchEvents(getCommunikeyRelays(), applyCuratedFilter({ kinds: [10222] }), { cache: true });

/**
 * Form templates (kind 30168) for given pubkey(s).
 * @param {string | string[]} pubkeys
 * @returns {import('rxjs').Observable<any>}
 */
export const formTemplateLoader = (pubkeys) =>
  fetchEvents(
    getCommunikeyRelays(),
    { kinds: [30168], authors: Array.isArray(pubkeys) ? pubkeys : [pubkeys] },
    { cache: true }
  );

/**
 * Form requests (kind 1070) sent to a specific user.
 * @param {string} recipientPubkey
 * @returns {import('rxjs').Observable<any>}
 */
export const formRequestLoader = (recipientPubkey) =>
  fetchEvents(getCommunikeyRelays(), { kinds: [1070], '#p': [recipientPubkey] }, { cache: true });

/**
 * Form responses (kind 1069) for a specific form.
 * @param {string} formAddress - Form coordinate: "30168:pubkey:d-tag"
 * @param {string} creatorPubkey - Form creator's pubkey (for #p filter efficiency)
 * @returns {import('rxjs').Observable<any>}
 */
export const formResponseLoader = (formAddress, creatorPubkey) =>
  fetchEvents(
    getCommunikeyRelays(),
    { kinds: [1069], '#a': [formAddress], '#p': [creatorPubkey] },
    { cache: true }
  );
