/**
 * Personal bookmarks singleton store.
 * Tracks the active user's kind 10003 bookmark list and kind 30003 bookmark sets.
 * Provides isBookmarked / isBookmarkedAnywhere / bookmark / unbookmark helpers.
 *
 * Uses actionRunner.exec() for optimistic UI — EventStore updates instantly
 * before relay publishing completes.
 */
import { isEventInList } from 'applesauce-common/helpers';
import { setTitle, setDescription } from 'applesauce-common/operations/list';
import { addEventBookmarkTag } from 'applesauce-common/operations/tag/bookmarks';
import { BookmarkEvent, UnbookmarkEvent } from 'applesauce-actions/actions';
import { modifyPublicTags } from 'applesauce-core/operations';
import { setSingletonTag } from 'applesauce-core/operations/tag/common';
import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { TimelineModel } from 'applesauce-core/models';
import { timedPool } from '$lib/loaders/base.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { manager } from '$lib/stores/accounts.svelte';
import { actionRunner, factory } from '$lib/stores/action-runner.svelte.js';
import { publishEvent } from '$lib/services/publish-service.js';
import { getWriteRelays } from '$lib/services/relay-service.svelte.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {import('nostr-tools').NostrEvent | null} */
let bookmarkListEvent = $state(null);

/** @type {import('nostr-tools').NostrEvent[]} */
let bookmarkSets = $state.raw([]);

let _isLoading = $state(false);

// ---------------------------------------------------------------------------
// Lifecycle — subscribe to active user changes, load bookmark list + sets
// ---------------------------------------------------------------------------

$effect.root(() => {
  /** @type {import('rxjs').Subscription | undefined} */
  let loaderSub;
  /** @type {import('rxjs').Subscription | undefined} */
  let modelSub;
  /** @type {import('rxjs').Subscription | undefined} */
  let setsLoaderSub;
  /** @type {import('rxjs').Subscription | undefined} */
  let setsModelSub;

  $effect(() => {
    const sub = manager.active$.subscribe((user) => {
      // Clean up previous subscriptions
      loaderSub?.unsubscribe();
      modelSub?.unsubscribe();
      setsLoaderSub?.unsubscribe();
      setsModelSub?.unsubscribe();
      bookmarkListEvent = null;
      bookmarkSets = [];

      if (!user?.pubkey) {
        _isLoading = false;
        return;
      }

      _isLoading = true;
      const pubkey = user.pubkey;

      // Subscribe to EventStore for kind 10003 (default bookmark list)
      modelSub = eventStore.replaceable(10003, pubkey).subscribe((event) => {
        bookmarkListEvent = event ?? null;
        _isLoading = false;
      });

      // Subscribe to EventStore for kind 30003 (bookmark sets)
      setsModelSub = eventStore
        .model(TimelineModel, {
          kinds: [30003],
          authors: [pubkey]
        })
        .subscribe((events) => {
          bookmarkSets = events ?? [];
        });

      // Fetch from relays
      getWriteRelays(pubkey).then((relays) => {
        // Load kind 10003
        const listLoader = createTimelineLoader(
          timedPool,
          relays,
          { kinds: [10003], authors: [pubkey], limit: 1 },
          { eventStore }
        );
        loaderSub = listLoader().subscribe();

        // Load kind 30003
        const setsLoader = createTimelineLoader(
          timedPool,
          relays,
          { kinds: [30003], authors: [pubkey] },
          { eventStore }
        );
        setsLoaderSub = setsLoader().subscribe();
      });
    });

    return () => {
      sub.unsubscribe();
      loaderSub?.unsubscribe();
      modelSub?.unsubscribe();
      setsLoaderSub?.unsubscribe();
      setsModelSub?.unsubscribe();
    };
  });
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Check if an event is in the user's default bookmark list (kind 10003).
 * @param {import('nostr-tools').NostrEvent} event
 * @returns {boolean}
 */
export function isBookmarked(event) {
  if (!bookmarkListEvent) return false;
  return isEventInList(bookmarkListEvent, event);
}

/**
 * Check if an event is in the default bookmark list OR any bookmark set.
 * @param {import('nostr-tools').NostrEvent} event
 * @returns {boolean}
 */
export function isBookmarkedAnywhere(event) {
  if (bookmarkListEvent && isEventInList(bookmarkListEvent, event)) return true;
  return bookmarkSets.some((set) => isEventInList(set, event));
}

/**
 * Check if an event is in a specific bookmark set.
 * @param {import('nostr-tools').NostrEvent} event
 * @param {import('nostr-tools').NostrEvent} setEvent
 * @returns {boolean}
 */
export function isInBookmarkSet(event, setEvent) {
  return isEventInList(setEvent, event);
}

// ---------------------------------------------------------------------------
// Actions (optimistic via exec)
// ---------------------------------------------------------------------------

/**
 * Add an event to a bookmark list or set.
 * Uses exec() for optimistic UI — EventStore updates before relay publish.
 * @param {import('nostr-tools').NostrEvent} event
 * @param {string} [identifier] - d-tag of a kind 30003 set, or undefined for default list
 */
export async function bookmark(event, identifier) {
  await actionRunner.exec(BookmarkEvent, event, identifier).forEach(async (signed) => {
    eventStore.add(signed);
    await publishEvent(signed);
  });
}

/**
 * Remove an event from a bookmark list or set.
 * Uses exec() for optimistic UI — EventStore updates before relay publish.
 * @param {import('nostr-tools').NostrEvent} event
 * @param {string} [identifier] - d-tag of a kind 30003 set, or undefined for default list
 */
export async function unbookmark(event, identifier) {
  await actionRunner.exec(UnbookmarkEvent, event, identifier).forEach(async (signed) => {
    eventStore.add(signed);
    await publishEvent(signed);
  });
}

/**
 * Create a new bookmark set (kind 30003) with a title and bookmark the event into it.
 * Builds the event manually to set proper d-tag and title tag.
 * @param {import('nostr-tools').NostrEvent} event - The event to bookmark
 * @param {string} title - Display title for the new set
 */
export async function createBookmarkSetAndBookmark(event, title) {
  const dTag = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const draft = await factory.build(
    { kind: 30003 },
    setTitle(title),
    modifyPublicTags(setSingletonTag(['d', dTag])),
    modifyPublicTags(addEventBookmarkTag(event))
  );
  const signed = await factory.sign(draft);
  eventStore.add(signed);
  publishEvent(signed);
}

/**
 * Return a new tags array with bookmark tags ('e' and 'a') at fromIndex and toIndex swapped.
 * Non-bookmark tags (d, title, description, etc.) are preserved at the front unchanged.
 * @param {import('nostr-tools').NostrEvent} setEvent
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {string[][]}
 */
export function getReorderedBookmarkTags(setEvent, fromIndex, toIndex) {
  const bookmarkTags = setEvent.tags.filter((t) => t[0] === 'e' || t[0] === 'a');
  const nonBookmarkTags = setEvent.tags.filter((t) => t[0] !== 'e' && t[0] !== 'a');
  const reordered = [...bookmarkTags];
  const temp = reordered[fromIndex];
  reordered[fromIndex] = reordered[toIndex];
  reordered[toIndex] = temp;
  return [...nonBookmarkTags, ...reordered];
}

/**
 * Reorder a bookmark item within a bookmark set by swapping two positions.
 * Creates a new signed event with the reordered tags and publishes it.
 * @param {import('nostr-tools').NostrEvent} setEvent - The existing kind 30003 event
 * @param {number} fromIndex - Index within bookmark tags (e/a only) to move from
 * @param {number} toIndex - Index within bookmark tags to move to
 */
export async function reorderBookmarkSetItem(setEvent, fromIndex, toIndex) {
  const newTags = getReorderedBookmarkTags(setEvent, fromIndex, toIndex);
  const draft = await factory.modify(setEvent, (event) => ({ ...event, tags: newTags }));
  const signed = await factory.sign(draft);
  eventStore.add(signed);
  publishEvent(signed);
}

/**
 * Update a bookmark set's title and/or description.
 * @param {import('nostr-tools').NostrEvent} setEvent - The existing kind 30003 event
 * @param {string} title - New title
 * @param {string} [description] - New description (empty string to clear)
 */
export async function updateBookmarkSet(setEvent, title, description) {
  const operations = [setTitle(title)];
  if (description !== undefined) {
    operations.push(setDescription(description || null));
  }
  const draft = await factory.modify(setEvent, ...operations);
  const signed = await factory.sign(draft);
  eventStore.add(signed);
  publishEvent(signed);
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

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

/**
 * Get all loaded bookmark sets (kind 30003).
 * @returns {import('nostr-tools').NostrEvent[]}
 */
export function getBookmarkSets() {
  return bookmarkSets;
}

/**
 * Get the display title for a bookmark set.
 * Falls back to d-tag if no title tag present.
 * @param {import('nostr-tools').NostrEvent} setEvent
 * @returns {string}
 */
export function getBookmarkSetTitle(setEvent) {
  const titleTag = setEvent.tags.find((t) => t[0] === 'title');
  if (titleTag?.[1]) return titleTag[1];
  const dTag = setEvent.tags.find((t) => t[0] === 'd');
  return dTag?.[1] || 'Untitled';
}

/**
 * Get the d-tag identifier for a bookmark set.
 * @param {import('nostr-tools').NostrEvent} setEvent
 * @returns {string}
 */
export function getBookmarkSetIdentifier(setEvent) {
  const dTag = setEvent.tags.find((t) => t[0] === 'd');
  return dTag?.[1] || '';
}
