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
import { tabCountsFromEvents, PROFILE_CONTENT_KINDS } from '$lib/helpers/profile-tabs.js';
import { withoutChannelMeetings } from '$lib/helpers/calendar-timing.js';
import { withParticipationCounts } from '$lib/helpers/educational/participation.js';

/**
 * @param {() => string} getPubkey - reactive getter for the profile pubkey
 * @param {() => string | null} [getUserPubkey] - reactive getter enabling the outbox path
 * @returns {{ getCounts: () => Record<string, number> }}
 */
export function useProfileContent(getPubkey, getUserPubkey = () => null) {
  let ownCounts = $state.raw(/** @type {Record<string, number>} */ (tabCountsFromEvents([])));
  // Resources and articles by others that credit the profile ("Beteiligt an")
  let credited = $state.raw(/** @type {any[]} */ ([]));

  $effect(() => {
    const pubkey = getPubkey();
    const userPubkey = getUserPubkey();

    untrack(() => {
      ownCounts = tabCountsFromEvents([]);
      credited = [];
    });
    if (!pubkey) return;

    const modelSub = eventStore
      .model(TimelineModel, { kinds: PROFILE_CONTENT_KINDS, authors: [pubkey] })
      .subscribe({
        next: (events) => {
          ownCounts = tabCountsFromEvents(withoutChannelMeetings(events));
        },
        error: (err) => console.error('useProfileContent: Model error:', err)
      });

    const creditedSub = eventStore
      .model(TimelineModel, { kinds: [30142, 30023], '#p': [pubkey] })
      .subscribe({
        next: (events) => {
          credited = events || [];
        },
        error: (err) => console.error('useProfileContent: Participation model error:', err)
      });

    // Defer loader creation so navigation isn't blocked right after mount —
    // the model above already emits cached data instantly.
    /** @type {import('rxjs').Subscription[]} */
    let loaderSubs = [];
    const loaderTimer = setTimeout(() => {
      loaderSubs = startProfileFeedLoaders({ pubkeys: [pubkey], userPubkey, profilePage: true });
    }, 100);

    return () => {
      clearTimeout(loaderTimer);
      modelSub.unsubscribe();
      creditedSub.unsubscribe();
      for (const sub of loaderSubs) sub.unsubscribe();
    };
  });

  const counts = $derived(withParticipationCounts(ownCounts, credited, getPubkey()));

  return { getCounts: () => counts };
}
