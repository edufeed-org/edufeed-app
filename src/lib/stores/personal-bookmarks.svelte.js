/**
 * Personal bookmarks singleton store.
 * Tracks the active user's kind 10003 bookmark list and provides
 * isBookmarked / bookmark / unbookmark helpers.
 */
import { isEventInList } from 'applesauce-common/helpers';
import { BookmarkEvent, UnbookmarkEvent } from 'applesauce-actions/actions';
import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { timedPool } from '$lib/loaders/base.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { manager } from '$lib/stores/accounts.svelte';
import { actionRunner } from '$lib/stores/action-runner.svelte.js';
import { getWriteRelays } from '$lib/services/relay-service.svelte.js';

/** @type {import('nostr-tools').NostrEvent | null} */
let bookmarkListEvent = $state(null);

let _isLoading = $state(false);

// Subscribe to active user changes and load bookmark list
$effect.root(() => {
  /** @type {import('rxjs').Subscription | undefined} */
  let loaderSub;
  /** @type {import('rxjs').Subscription | undefined} */
  let modelSub;

  $effect(() => {
    const sub = manager.active$.subscribe((user) => {
      // Clean up previous subscriptions
      loaderSub?.unsubscribe();
      modelSub?.unsubscribe();
      bookmarkListEvent = null;

      if (!user?.pubkey) {
        _isLoading = false;
        return;
      }

      _isLoading = true;
      const pubkey = user.pubkey;

      // Subscribe to EventStore immediately (sync)
      modelSub = eventStore.replaceable(10003, pubkey).subscribe((event) => {
        bookmarkListEvent = event ?? null;
        _isLoading = false;
      });

      // Fetch kind 10003 from user's NIP-65 write relays (async)
      getWriteRelays(pubkey).then((relays) => {
        const loader = createTimelineLoader(
          timedPool,
          relays,
          {
            kinds: [10003],
            authors: [pubkey],
            limit: 1
          },
          { eventStore }
        );
        loaderSub = loader().subscribe();
      });
    });

    return () => {
      sub.unsubscribe();
      loaderSub?.unsubscribe();
      modelSub?.unsubscribe();
    };
  });
});

/**
 * Check if an event is in the user's bookmark list.
 * @param {import('nostr-tools').NostrEvent} event
 * @returns {boolean}
 */
export function isBookmarked(event) {
  if (!bookmarkListEvent) return false;
  return isEventInList(bookmarkListEvent, event);
}

/**
 * Add an event to the user's bookmark list (kind 10003).
 * @param {import('nostr-tools').NostrEvent} event
 */
export async function bookmark(event) {
  await actionRunner.run(BookmarkEvent, event);
}

/**
 * Remove an event from the user's bookmark list (kind 10003).
 * @param {import('nostr-tools').NostrEvent} event
 */
export async function unbookmark(event) {
  await actionRunner.run(UnbookmarkEvent, event);
}

/**
 * Whether the bookmark list is still loading.
 * @returns {boolean}
 */
export function getIsLoading() {
  return _isLoading;
}

/**
 * Get the raw bookmark list event (kind 10003), or null if not loaded.
 * @returns {import('nostr-tools').NostrEvent | null}
 */
export function getBookmarkListEvent() {
  return bookmarkListEvent;
}
