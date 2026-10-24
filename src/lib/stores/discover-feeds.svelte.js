/**
 * useDiscoverFeeds — the discover page's paging feeds (articles, learning,
 * boards; one `createTimelineFeed` each) behind a reactive facade.
 *
 * Owns the feed subscriptions for the component's lifetime, mirrors each
 * feed's status, re-syncs the feeds when user relay overrides (kind 30002)
 * or the curated/WoT author set arrive after mount, and applies the page's
 * two gates: `isShown(type)` (the current tab) and `isPaged(type)` (a
 * learning NIP-50 search is one ranked batch the feed does not page).
 *
 * Store first: events flow into the EventStore and the models render them;
 * the status here only drives the skeleton, the bottom spinner and "no
 * more". Call during component initialisation (it creates effects).
 */
import { untrack } from 'svelte';
import { fromStore } from 'svelte/store';
import { relayUpdateSignal } from '$lib/services/app-relay-service.svelte.js';
import { getCuratedCacheVersion } from '$lib/services/curated-authors-service.svelte.js';

/**
 * @typedef {import('$lib/loaders/timeline-feed.js').TimelineFeed} TimelineFeed
 * @typedef {import('$lib/loaders/timeline-feed.js').TimelineFeedStatus} TimelineFeedStatus
 * @typedef {{ type: string, feed: TimelineFeed }} DiscoverFeed
 *
 * @typedef {object} DiscoverFeedsOptions
 * @property {DiscoverFeed[]} feeds - The enabled feeds, keyed by discover content type
 * @property {(type: string) => boolean} isShown - Whether the current tab shows a feed type
 * @property {(type: string) => boolean} [isPaged] - Whether a feed type pages right now (default: always)
 * @property {() => void} onReveal - A shown feed delivered the page it was waiting for
 */

/**
 * @param {DiscoverFeedsOptions} options
 */
export function useDiscoverFeeds({ feeds, isShown, isPaged = () => true, onReveal }) {
  /** Latest status per feed type. $state.raw: replaced wholesale, never mutated. */
  let status = $state.raw(/** @type {Record<string, TimelineFeedStatus>} */ ({}));
  const relaySignal = fromStore(relayUpdateSignal);

  // Start the feeds. Status is merged untracked: status$ replays synchronously
  // inside this effect and the merge reads the state it writes.
  $effect(() => {
    const subs = feeds.flatMap(({ type, feed }) => [
      feed.events$.subscribe({
        error: (/** @type {any} */ error) =>
          console.error(`🔍 Discover: ${type} feed error:`, error)
      }),
      feed.status$.subscribe((next) => {
        untrack(() => {
          const wasPending = status[type]?.pending ?? false;
          status = { ...status, [type]: next };
          // Keyed on the feed's own transition, so switching tabs while
          // another feed is pending reveals nothing here.
          if (wasPending && !next.pending && isShown(type)) onReveal();
        });
      })
    ]);
    return () => subs.forEach((s) => s.unsubscribe());
  });

  // Feeds re-read their relays and curated filter whenever user relay
  // overrides or the curated/WoT author set change. The SDK reconciles per
  // relay: a new relay loads the current window, a grown author list
  // requests only the added authors.
  $effect(() => {
    const _relays = relaySignal.current;
    const _curated = getCuratedCacheVersion();
    for (const { feed } of feeds) feed.sync();
  });

  const shown = $derived(feeds.filter((f) => isShown(f.type)));
  const paged = $derived(shown.filter((f) => isPaged(f.type)));

  return {
    get status() {
      return status;
    },
    /** Every feed has settled (false without feeds: the calendar owns the spinner then). */
    get settled() {
      return feeds.length > 0 && feeds.every((f) => status[f.type]?.settled ?? false);
    },
    /** A shown feed waits for a page it has not buffered yet. */
    get pending() {
      return shown.some((f) => status[f.type]?.pending ?? false);
    },
    /** A relay of a shown feed failed and the SDK is backing off before it retries. */
    get failing() {
      return shown.some((f) => status[f.type]?.failing ?? false);
    },
    /** Some shown, paging feed is not exhausted. */
    get hasMore() {
      return paged.some((f) => !(status[f.type]?.exhausted ?? false));
    },
    /** Widen every shown, paging feed's window by one page. */
    loadMore() {
      for (const { feed } of paged) feed.loadMore();
    }
  };
}
