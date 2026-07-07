/**
 * Reactive hook that hoists profile-content loading to page level.
 *
 * Starts the shared feed loaders once per profile (all feed kinds + reposts,
 * see profile-feed-loaders.js) and exposes progressive per-tab counts from a
 * single TimelineModel subscription. Tab panels subscribe to their own
 * models against the EventStore — they never fetch.
 */
import { untrack } from 'svelte';
import { TimelineModel } from 'applesauce-core/models';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { startProfileFeedLoaders } from '$lib/loaders/profile-feed-loaders.js';
import { ALL_FEED_KINDS } from '$lib/helpers/profile-feed.js';
import { tabCountsFromEvents } from '$lib/helpers/profile-tabs.js';

/**
 * @param {() => string} getPubkey - reactive getter for the profile pubkey
 * @param {() => string | null} [getUserPubkey] - reactive getter enabling the outbox path
 * @returns {{ getCounts: () => Record<string, number> }}
 */
export function useProfileContent(getPubkey, getUserPubkey = () => null) {
  let counts = $state.raw(/** @type {Record<string, number>} */ (tabCountsFromEvents([])));

  $effect(() => {
    const pubkey = getPubkey();
    const userPubkey = getUserPubkey();

    untrack(() => {
      counts = tabCountsFromEvents([]);
    });
    if (!pubkey) return;

    const modelSub = eventStore
      .model(TimelineModel, { kinds: ALL_FEED_KINDS, authors: [pubkey] })
      .subscribe({
        next: (events) => {
          counts = tabCountsFromEvents(events);
        },
        error: (err) => console.error('useProfileContent: Model error:', err)
      });

    // Defer loader creation so navigation isn't blocked right after mount —
    // the model above already emits cached data instantly.
    /** @type {import('rxjs').Subscription[]} */
    let loaderSubs = [];
    const loaderTimer = setTimeout(() => {
      loaderSubs = startProfileFeedLoaders({ pubkeys: [pubkey], userPubkey });
    }, 100);

    return () => {
      clearTimeout(loaderTimer);
      modelSub.unsubscribe();
      for (const sub of loaderSubs) sub.unsubscribe();
    };
  });

  return { getCounts: () => counts };
}
