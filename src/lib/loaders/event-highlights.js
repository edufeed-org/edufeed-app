/**
 * Highlight loader for addressable events (kind 30023, 30818, etc.).
 * Loads kind 9802 highlights that reference an event via #a tag.
 */
import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { timedPool } from './base.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';

/**
 * Load highlights for an addressable event.
 * @param {import('nostr-tools/nip19').AddressPointer} pointer - The event to load highlights for
 * @param {string} [communityPubkey] - Optional community scoping via #h tag
 * @returns {{ loader: Function, cleanup: () => void }}
 */
export function loadEventHighlights(pointer, communityPubkey) {
  const aTagValue = `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`;

  /** @type {import('nostr-tools').Filter} */
  const filter = {
    kinds: [9802],
    '#a': [aTagValue]
  };

  if (communityPubkey) {
    filter['#h'] = [communityPubkey];
  }

  const relays = getAllLookupRelays();
  const loader = createTimelineLoader(timedPool, relays, filter, {
    eventStore,
    limit: 100
  });

  /** @type {import('rxjs').Subscription | undefined} */
  let sub;

  return {
    loader: () => {
      sub = loader().subscribe();
      return sub;
    },
    cleanup: () => {
      sub?.unsubscribe();
    }
  };
}
