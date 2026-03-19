/**
 * Generic community content loader factory.
 * Extracts the shared loading pattern used by community content views:
 * 1. Direct content (h-tagged events from content relays + community relays)
 * 2. NIP-18 reposts (kind 6/16 with h-tag targeting the community)
 * 3. Targeted publications (kind 30222 from communikey relays) — legacy, read-only
 * 4. Reference resolution for both reposts and legacy shares
 */
import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { TimelineModel } from 'applesauce-core/models';
import { getTagValue } from 'applesauce-core/helpers';
import { parseAddressPointerFromATag } from '$lib/helpers/nostrUtils.js';
import { onlyEvents } from 'applesauce-relay/operators';
import { mapEventsToStore } from 'applesauce-core/observable';
import { addressLoader, timedPool } from './base.js';
import { communityTargetedPublicationsLoader } from './targeted-publications.js';
import { getCommunityGlobalRelays } from '$lib/helpers/communityRelays.js';

/**
 * Create a community content loader for any content type.
 *
 * @param {number[]} kinds - Event kinds to load (e.g. [30142], [30301], [30023])
 * @param {() => string[]} getRelays - Function returning relay URLs for this content type
 * @param {Object} [options]
 * @param {(filter: import('nostr-tools').Filter) => import('nostr-tools').Filter} [options.filterFn] - Filter transform (e.g. applyCuratedFilter)
 * @returns {(communityPubkey: string) => { subscriptions: Map<string, any>, cleanup: () => void }}
 */
export function createCommunityContentLoader(kinds, getRelays, options = {}) {
  const { filterFn } = options;
  const kTagStrings = kinds.map(String);

  return function (communityPubkey) {
    const subscriptions = new Map();

    if (!communityPubkey) {
      return { subscriptions, cleanup: () => {} };
    }

    const appRelays = getRelays();

    // Merge app relays with the community's own relays from its kind 10222 event.
    const communityEvent = eventStore.getReplaceable(10222, communityPubkey);
    const communityRelays = getCommunityGlobalRelays(communityEvent);
    const relays = [...new Set([...appRelays, ...communityRelays])];

    // 1. Direct community content (events with h-tag matching community)
    const directFilter = { kinds, '#h': [communityPubkey] };
    const finalDirectFilter = filterFn ? filterFn(directFilter) : directFilter;
    const directLoader = createTimelineLoader(timedPool, relays, finalDirectFilter, {
      eventStore,
      limit: 50
    });
    subscriptions.set('direct', directLoader().subscribe());

    // 2. NIP-18 reposts (kind 6/16 with h-tag targeting this community)
    const repostLoader = createTimelineLoader(
      timedPool,
      relays,
      { kinds: [6, 16], '#h': [communityPubkey] },
      { eventStore, limit: 50 }
    );
    subscriptions.set('reposts', repostLoader().subscribe());

    // 3. Legacy targeted publications (kind 30222) — backward compat
    const targetedPubSub = communityTargetedPublicationsLoader(
      communityPubkey,
      kinds
    )().subscribe();
    subscriptions.set('targetedPublications', targetedPubSub);

    // 4a. Watch legacy 30222 shares and load referenced content on-demand
    const loadedEventIds = new Set();
    const loadedAddresses = new Set();

    const legacyReferencedSub = eventStore
      .model(TimelineModel, {
        kinds: [30222],
        '#p': [communityPubkey],
        '#k': kTagStrings,
        limit: 100
      })
      .subscribe((shareEvents) => {
        const newEventIds = [];
        /** @type {Array<{kind: number, pubkey: string, identifier: string}>} */
        const newAddressRefs = [];

        for (const shareEvent of shareEvents) {
          const eTag = getTagValue(shareEvent, 'e');
          const aTag = getTagValue(shareEvent, 'a');

          if (eTag && !loadedEventIds.has(eTag)) {
            loadedEventIds.add(eTag);
            newEventIds.push(eTag);
          }
          if (aTag && !loadedAddresses.has(aTag)) {
            loadedAddresses.add(aTag);
            const parsed = parseAddressPointerFromATag(aTag);
            if (parsed) {
              newAddressRefs.push({
                kind: parsed.kind,
                pubkey: parsed.pubkey,
                identifier: parsed.identifier
              });
            }
          }
        }

        if (newEventIds.length > 0) {
          const sub = pool
            .subscription(relays, { ids: newEventIds })
            .pipe(onlyEvents(), mapEventsToStore(eventStore))
            .subscribe();
          subscriptions.set(`refById-${Date.now()}`, sub);
        }

        if (newAddressRefs.length > 0) {
          for (const ref of newAddressRefs) {
            addressLoader({
              kind: ref.kind,
              pubkey: ref.pubkey,
              identifier: ref.identifier
            }).subscribe();
          }
        }
      });
    subscriptions.set('legacyReferenced', legacyReferencedSub);

    // 4b. Watch NIP-18 reposts and load referenced content on-demand
    const repostLoadedEventIds = new Set();
    const repostLoadedAddresses = new Set();

    const repostReferencedSub = eventStore
      .model(TimelineModel, {
        kinds: [6, 16],
        '#h': [communityPubkey],
        limit: 100
      })
      .subscribe((repostEvents) => {
        const newEventIds = [];
        /** @type {Array<{kind: number, pubkey: string, identifier: string}>} */
        const newAddressRefs = [];

        for (const repostEvent of repostEvents) {
          const eTag = getTagValue(repostEvent, 'e');
          const aTag = getTagValue(repostEvent, 'a');

          if (eTag && !repostLoadedEventIds.has(eTag) && !loadedEventIds.has(eTag)) {
            repostLoadedEventIds.add(eTag);
            newEventIds.push(eTag);
          }
          if (aTag && !repostLoadedAddresses.has(aTag) && !loadedAddresses.has(aTag)) {
            repostLoadedAddresses.add(aTag);
            const parsed = parseAddressPointerFromATag(aTag);
            if (parsed) {
              newAddressRefs.push({
                kind: parsed.kind,
                pubkey: parsed.pubkey,
                identifier: parsed.identifier
              });
            }
          }

          // Also try to extract embedded event from content
          if (repostEvent.content) {
            try {
              const embedded = JSON.parse(repostEvent.content);
              if (embedded && embedded.id && embedded.kind) {
                eventStore.add(embedded);
              }
            } catch {
              // Not valid JSON — ignore
            }
          }
        }

        if (newEventIds.length > 0) {
          const sub = pool
            .subscription(relays, { ids: newEventIds })
            .pipe(onlyEvents(), mapEventsToStore(eventStore))
            .subscribe();
          subscriptions.set(`repostRefById-${Date.now()}`, sub);
        }

        if (newAddressRefs.length > 0) {
          for (const ref of newAddressRefs) {
            addressLoader({
              kind: ref.kind,
              pubkey: ref.pubkey,
              identifier: ref.identifier
            }).subscribe();
          }
        }
      });
    subscriptions.set('repostReferenced', repostReferencedSub);

    function cleanup() {
      subscriptions.forEach((sub) => {
        if (sub && typeof sub.unsubscribe === 'function') {
          sub.unsubscribe();
        }
      });
      subscriptions.clear();
    }

    return { subscriptions, cleanup };
  };
}
