import { communikeyTimelineLoader } from '$lib/loaders';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { TimelineModel } from 'applesauce-core/models';
import { applyCuratedFilter } from '$lib/services/curated-authors-service.svelte.js';

// Global state that persists across page navigations
let globalCommunities = $state(/** @type {import('nostr-tools').Event[]} */ ([]));
let globalLoaded = $state(false);
/** @type {{ unsubscribe: () => void } | null} */
let globalSubscription = null;

/**
 * Custom hook for loading and managing all communities
 * Uses EventStore's automatic replaceable event handling for kind 10222
 * Uses TimelineModel for deletion filtering and curated author defense-in-depth
 * @returns {() => Array<import('nostr-tools').Event>} - Reactive getter function returning array of all community events
 */
export function useAllCommunities() {
  // Initialize global subscription only once
  if (!globalSubscription) {
    // Bootstrap EventStore with community loader (feeds events into EventStore)
    const loaderSubscription = communikeyTimelineLoader()().subscribe({
      complete: () => {
        globalLoaded = true;
      },
      error: () => {
        globalLoaded = true;
      }
    });

    // Safety timeout: timedPool gives relays 2s, so 5s is generous.
    // Ensures we never show a spinner forever if the loader Observable doesn't complete
    // (e.g., all relays unreachable and pool.request never emits/completes).
    setTimeout(() => {
      globalLoaded = true;
    }, 5_000);

    // Use TimelineModel for reactive data with deletion filtering.
    // Also applies curated authors as defense-in-depth: even if a non-curated
    // community event enters the store from another code path, it won't appear here.
    const filter = applyCuratedFilter({ kinds: [10222] });

    const timelineSubscription = eventStore.model(TimelineModel, filter).subscribe({
      next: (events) => {
        globalCommunities = /** @type {import('nostr-tools').Event[]} */ (events);
        globalLoaded = true;
      },
      error: (/** @type {any} */ error) => {
        console.error('📋 AllCommunities: Error loading community events:', error);
        globalCommunities = [];
        globalLoaded = true;
      }
    });

    // Store combined subscription for cleanup
    globalSubscription = {
      unsubscribe: () => {
        loaderSubscription.unsubscribe();
        timelineSubscription.unsubscribe();
      }
    };
  }

  // Return a getter function that provides reactive access to all communities
  return () => globalCommunities;
}

/**
 * Returns whether the initial community load has completed (EOSE received).
 * Use this to distinguish "still loading" from "loaded but empty".
 * @returns {() => boolean}
 */
export function useAllCommunitiesLoaded() {
  return () => globalLoaded;
}
