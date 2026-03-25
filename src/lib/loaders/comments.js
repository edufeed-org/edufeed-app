/**
 * Comment loader for NIP-22 comments and NIP-10 replies
 * Provides a factory for creating timeline loaders specific to event comments
 */
import { merge } from 'rxjs';
import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { getSeenRelays } from 'applesauce-core/helpers';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { timedPool } from '$lib/loaders/base.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';

/**
 * Create a comment loader for any event type (regular or addressable).
 * Auto-detects the event type and uses the correct filter:
 * - Addressable events (kind 30000-39999): #A filter with address
 * - Kind 1 events: dual-filter (kind 1111 #E + kind 1 #e) merged
 * - Other regular events: #E filter with event ID
 *
 * Relays are determined from the root event's seen relays (where the event was
 * found on the network) plus fallback relays. This ensures comments are fetched
 * from the same relays as the root event (e.g. communikey relays for forum threads).
 *
 * @param {any} rootEvent - The root event to load comments for
 * @param {string[]} [extraRelays] - Additional relays to query
 * @returns {Function} Timeline loader function that returns an Observable
 */
export const createCommentLoaderForEvent = (rootEvent, extraRelays) => {
  if (!rootEvent) {
    throw new Error('Root event is required to create comment loader');
  }

  const isAddressable = rootEvent.kind >= 30000 && rootEvent.kind < 40000;

  // Use seen relays (where the root event was found) + fallback + any extras
  const seenRelays = getSeenRelays(rootEvent);
  const relays = [
    ...(runtimeConfig.fallbackRelays || []),
    ...(seenRelays ? Array.from(seenRelays) : []),
    ...(extraRelays || [])
  ];
  const uniqueRelays = [...new Set(relays)];

  if (isAddressable) {
    const dTag = rootEvent.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || '';
    /** @type {import('nostr-tools').Filter} */
    const filter = {
      kinds: [1111],
      '#A': [`${rootEvent.kind}:${rootEvent.pubkey}:${dTag}`],
      limit: 100
    };
    return createTimelineLoader(timedPool, uniqueRelays, filter, { eventStore });
  }

  // NIP-22 comments filter (works for all regular events)
  /** @type {import('nostr-tools').Filter} */
  const nip22Filter = { kinds: [1111], '#E': [rootEvent.id], limit: 100 };

  if (rootEvent.kind === 1) {
    // Kind 1 notes also get NIP-10 replies (kind 1 with #e tag)
    /** @type {import('nostr-tools').Filter} */
    const nip10Filter = { kinds: [1], '#e': [rootEvent.id], limit: 100 };

    const nip22Loader = createTimelineLoader(timedPool, uniqueRelays, nip22Filter, { eventStore });
    const nip10Loader = createTimelineLoader(timedPool, uniqueRelays, nip10Filter, { eventStore });

    return () => merge(nip22Loader(), nip10Loader());
  }

  // Other regular events: NIP-22 only
  return createTimelineLoader(timedPool, uniqueRelays, nip22Filter, { eventStore });
};
