/**
 * Polls loader for kind 1068 (NIP-88).
 * Polls have no dedicated app-relay category — use communikey + fallback relays.
 */
import { getTagValue } from 'applesauce-core/helpers';
import { getFallbackRelays, getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
import { getCommunityGlobalRelays } from '$lib/helpers/communityRelays.js';
import { extractPollRelayTags } from '$lib/helpers/polls.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { createCommunityContentLoader } from './community-content-loader.js';
import { createCachedTimelineLoader } from './base.js';

export function getPollRelays() {
  return [...new Set([...getCommunikeyRelays(), ...getFallbackRelays()])];
}

/** Hook: Load polls for a specific community */
export const usePollCommunityLoader = createCommunityContentLoader([1068], getPollRelays);

/**
 * Build a loader that fetches kind 1018 responses for a single poll event from
 * the union of: the poll's `relay` tags, the targeted community's relays
 * (if the poll has an `h` tag), and our communikey + fallback relays.
 *
 * Kept as a factory (returns a loader fn) so component effects can call it
 * once per poll and subscribe to the resulting Observable.
 *
 * @param {any} poll - kind 1068 event
 * @returns {() => import('rxjs').Observable<any>}
 */
export function pollResponsesLoader(poll) {
  const pollRelays = extractPollRelayTags(poll);
  const communityHex = getTagValue(poll, 'h');
  const communityEvent = communityHex ? eventStore.getReplaceable(10222, communityHex) : null;
  const communityRelays = communityEvent ? getCommunityGlobalRelays(communityEvent) : [];

  const relays = [...new Set([...pollRelays, ...communityRelays, ...getPollRelays()])];

  return createCachedTimelineLoader(relays, { kinds: [1018], '#e': [poll.id], limit: 500 });
}
