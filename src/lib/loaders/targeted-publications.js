/**
 * Targeted Publications Loader
 * Loads kind 30222 events that share content with communities
 *
 * Targeted publications have:
 * - 'p' tag: target community pubkey
 * - 'k' tag: kind of referenced content
 * - 'a' or 'e' tag: reference to the actual content
 */
import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
import { fetchEvents } from './base.js';

/**
 * Get relays for targeted publications (communikey + fallback)
 * Respects gated mode - when active, fallback relays are excluded
 * @returns {string[]}
 */
function getTargetedPublicationRelays() {
  return getCommunikeyRelays();
}

/**
 * All targeted publications (kind 30222): shares of articles, AMB resources
 * and calendar events. One-shot: cache + communikey relays into the EventStore.
 * @param {number} limit - Maximum number of events to load
 * @returns {import('rxjs').Observable<any>}
 */
export function allTargetedPublicationsLoader(limit = 200) {
  return fetchEvents(getTargetedPublicationRelays(), { kinds: [30222], limit }, { cache: true });
}

/**
 * Article-specific targeted publications. One-shot.
 * @param {number} limit - Maximum number of events to load
 * @returns {import('rxjs').Observable<any>}
 */
export function articleTargetedPublicationsLoader(limit = 100) {
  return fetchEvents(
    getTargetedPublicationRelays(),
    {
      kinds: [30222],
      '#k': ['30023'], // Only article shares
      limit
    },
    { cache: true }
  );
}

/**
 * Community-specific targeted publications. One-shot; always the communikey
 * relays since kind 30222 is a community/social event.
 * @param {string} communityPubkey - The community's public key to filter by
 * @param {number[]} contentKinds - Event kinds of the referenced content (e.g. [30142], [31922, 31923])
 * @param {number} [limit=100] - Maximum number of events to load
 * @returns {import('rxjs').Observable<any>}
 */
export function communityTargetedPublicationsLoader(communityPubkey, contentKinds, limit = 100) {
  return fetchEvents(
    getTargetedPublicationRelays(),
    {
      kinds: [30222],
      '#p': [communityPubkey],
      '#k': contentKinds.map(String),
      limit
    },
    { cache: true }
  );
}
