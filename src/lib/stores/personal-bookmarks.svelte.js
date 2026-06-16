/**
 * Personal bookmarks singleton store.
 * Tracks the active user's kind 10003 bookmark list and kind 30003 bookmark sets.
 * Provides isBookmarked / isBookmarkedAnywhere / bookmark / unbookmark helpers.
 *
 * Optimistic UI: bookmark/unbookmark set an override synchronously via
 * createOptimisticState() before any async signing/publishing, so query
 * functions return the target state instantly. The override is cleared
 * once the async work completes (eventStore then holds the real signed event).
 */
import { isEventInList } from 'applesauce-common/helpers';
import { createOptimisticState } from '$lib/helpers/optimistic-action.js';
import { setTitle, setDescription } from 'applesauce-common/operations/list';
import {
  addAnyKindBookmarkTag,
  removeAnyKindBookmarkTag,
  isUrlInList,
  addUrlTag,
  removeUrlTag
} from '$lib/helpers/bookmark-tag.js';
import { modifyPublicTags } from 'applesauce-core/operations';
import { setSingletonTag } from 'applesauce-core/operations/tag/common';
import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { TimelineModel } from 'applesauce-core/models';
import { timedPool } from '$lib/loaders/base.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { manager } from '$lib/stores/accounts.svelte';
import { factory } from '$lib/stores/action-runner.svelte.js';
import { publishEvent } from '$lib/services/publish-service.js';
import { getWriteRelays } from '$lib/services/relay-service.svelte.js';
import { showToast } from '$lib/helpers/toast.js';
import * as m from '$lib/paraglide/messages';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {import('nostr-tools').NostrEvent | null} */
let bookmarkListEvent = $state(null);

/** @type {import('nostr-tools').NostrEvent[]} */
let bookmarkSets = $state.raw([]);

let _isLoading = $state(false);

/** Optimistic overrides for instant bookmark toggle feedback. */
const optimistic = createOptimisticState();

/** Shared slow-signer options: show toast after 1.5s if signing is still pending. */
const signerSlowOpts = {
  slowThreshold: 1500,
  onSlow: () => showToast(m.bookmark_toast_awaiting_signer(), 'info', 0)
};

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
 * Build the optimistic override key for a bookmark action.
 * @param {string} eventId
 * @param {string} [identifier]
 * @returns {string}
 */
function optimisticKey(eventId, identifier) {
  return `${eventId}:${identifier ?? 'default'}`;
}

/**
 * Check if an event is in the user's default bookmark list (kind 10003).
 * Checks optimistic overrides first for instant feedback.
 * @param {import('nostr-tools').NostrEvent} event
 * @returns {boolean}
 */
export function isBookmarked(event) {
  const key = optimisticKey(event.id);
  if (optimistic.has(key)) return /** @type {boolean} */ (optimistic.get(key));
  if (!bookmarkListEvent) return false;
  return isEventInList(bookmarkListEvent, event);
}

/**
 * Check if an event is in the default bookmark list OR any bookmark set.
 * Respects optimistic overrides for instant feedback.
 * @param {import('nostr-tools').NostrEvent} event
 * @returns {boolean}
 */
export function isBookmarkedAnywhere(event) {
  if (isBookmarked(event)) return true;
  return bookmarkSets.some((set) => isInBookmarkSet(event, set));
}

/**
 * Check if an event is in a specific bookmark set.
 * Checks optimistic overrides first for instant feedback.
 * @param {import('nostr-tools').NostrEvent} event
 * @param {import('nostr-tools').NostrEvent} setEvent
 * @returns {boolean}
 */
export function isInBookmarkSet(event, setEvent) {
  const key = optimisticKey(event.id, getBookmarkSetIdentifier(setEvent));
  if (optimistic.has(key)) return /** @type {boolean} */ (optimistic.get(key));
  return isEventInList(setEvent, event);
}

// ---------------------------------------------------------------------------
// URL queries (NIP-51 `r` tags) — for web bookmarks that have no Nostr event.
// Plain URLs can't be referenced via e/a tags, so they live as `r` entries.
// The matching/tag helpers live in bookmark-tag.js (shared + unit-tested).
// ---------------------------------------------------------------------------

/**
 * Check if a URL is in the default bookmark list (kind 10003).
 * @param {string} url
 * @returns {boolean}
 */
export function isUrlBookmarked(url) {
  const key = optimisticKey(url);
  if (optimistic.has(key)) return /** @type {boolean} */ (optimistic.get(key));
  return isUrlInList(bookmarkListEvent, url);
}

/**
 * Check if a URL is in a specific bookmark set (kind 30003).
 * @param {string} url
 * @param {import('nostr-tools').NostrEvent} setEvent
 * @returns {boolean}
 */
export function isUrlInBookmarkSet(url, setEvent) {
  const key = optimisticKey(url, getBookmarkSetIdentifier(setEvent));
  if (optimistic.has(key)) return /** @type {boolean} */ (optimistic.get(key));
  return isUrlInList(setEvent, url);
}

/**
 * Whether a URL bookmark action is in-flight for a given list.
 * @param {string} url
 * @param {string} [identifier]
 * @returns {boolean}
 */
export function isUrlBookmarkPending(url, identifier) {
  return optimistic.isPending(optimisticKey(url, identifier));
}

// ---------------------------------------------------------------------------
// Actions (optimistic via exec)
// ---------------------------------------------------------------------------

/**
 * Resolve the existing list event for a given identifier.
 * - undefined → kind 10003 default list
 * - string    → kind 30003 set with matching d-tag
 * @param {string} [identifier]
 * @returns {import('nostr-tools').NostrEvent | null}
 */
function findListEvent(identifier) {
  if (identifier === undefined) return bookmarkListEvent;
  return bookmarkSets.find((s) => getBookmarkSetIdentifier(s) === identifier) ?? null;
}

/**
 * Slugify a set title into a NIP-51 `d` tag identifier.
 * @param {string} title
 * @returns {string}
 */
function titleToDTag(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Sign + cache + publish a NIP-51 list event draft.
 * Uses outbox model via publishEvent.
 * @param {import('nostr-tools').EventTemplate} draft
 */
async function signAndPublish(draft) {
  const signed = await factory.sign(draft);
  eventStore.add(signed);
  publishEvent(signed).catch((err) => console.warn('Bookmark publish failed:', err));
}

/**
 * Add an event to a bookmark list or set.
 * Uses kind-agnostic tag helper so any kind (e.g. 30142) is bookmarkable.
 * Sets optimistic override instantly, then signs and publishes in background.
 * @param {import('nostr-tools').NostrEvent} event
 * @param {string} [identifier] - d-tag of a kind 30003 set, or undefined for default list
 */
export async function bookmark(event, identifier) {
  const key = optimisticKey(event.id, identifier);
  await optimistic.run(
    key,
    true,
    async () => {
      const existing = findListEvent(identifier);
      const tagOp = modifyPublicTags(addAnyKindBookmarkTag(event));
      const draft = existing
        ? await factory.modify(existing, tagOp)
        : await factory.build({ kind: 10003 }, tagOp);
      await signAndPublish(draft);
    },
    signerSlowOpts
  );
}

/**
 * Remove an event from a bookmark list or set.
 * Sets optimistic override instantly, then signs and publishes in background.
 * @param {import('nostr-tools').NostrEvent} event
 * @param {string} [identifier] - d-tag of a kind 30003 set, or undefined for default list
 */
export async function unbookmark(event, identifier) {
  const key = optimisticKey(event.id, identifier);
  await optimistic.run(
    key,
    false,
    async () => {
      const existing = findListEvent(identifier);
      if (!existing) return; // nothing to remove
      const draft = await factory.modify(
        existing,
        modifyPublicTags(removeAnyKindBookmarkTag(event))
      );
      await signAndPublish(draft);
    },
    signerSlowOpts
  );
}

/**
 * Create a new bookmark set (kind 30003) with a title and bookmark the event into it.
 * Builds the event manually to set proper d-tag and title tag.
 * @param {import('nostr-tools').NostrEvent} event - The event to bookmark
 * @param {string} title - Display title for the new set
 */
export async function createBookmarkSetAndBookmark(event, title) {
  const draft = await factory.build(
    { kind: 30003 },
    setTitle(title),
    modifyPublicTags(setSingletonTag(['d', titleToDTag(title)])),
    modifyPublicTags(addAnyKindBookmarkTag(event))
  );
  const signed = await factory.sign(draft);
  eventStore.add(signed);
  publishEvent(signed);
}

// ---------------------------------------------------------------------------
// URL actions (NIP-51 `r` tags) — counterparts to the event actions above.
// Tag operations (addUrlTag/removeUrlTag) live in bookmark-tag.js.
// ---------------------------------------------------------------------------

/**
 * Add a URL to a bookmark list or set via an `r` tag.
 * @param {string} url
 * @param {string} [identifier] - d-tag of a kind 30003 set, or undefined for default list
 */
export async function bookmarkUrl(url, identifier) {
  const key = optimisticKey(url, identifier);
  await optimistic.run(
    key,
    true,
    async () => {
      const existing = findListEvent(identifier);
      const tagOp = modifyPublicTags(addUrlTag(url));
      const draft = existing
        ? await factory.modify(existing, tagOp)
        : await factory.build({ kind: 10003 }, tagOp);
      await signAndPublish(draft);
    },
    signerSlowOpts
  );
}

/**
 * Remove a URL from a bookmark list or set.
 * @param {string} url
 * @param {string} [identifier] - d-tag of a kind 30003 set, or undefined for default list
 */
export async function unbookmarkUrl(url, identifier) {
  const key = optimisticKey(url, identifier);
  await optimistic.run(
    key,
    false,
    async () => {
      const existing = findListEvent(identifier);
      if (!existing) return;
      const draft = await factory.modify(existing, modifyPublicTags(removeUrlTag(url)));
      await signAndPublish(draft);
    },
    signerSlowOpts
  );
}

/**
 * Create a new bookmark set (kind 30003) and add a URL to it via an `r` tag.
 * @param {string} url
 * @param {string} title - Display title for the new set
 */
export async function createBookmarkSetAndBookmarkUrl(url, title) {
  const draft = await factory.build(
    { kind: 30003 },
    setTitle(title),
    modifyPublicTags(setSingletonTag(['d', titleToDTag(title)])),
    modifyPublicTags(addUrlTag(url))
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
 * Remove an item from any NIP-51 list event by filtering out its e/a tag.
 * Works for kind 10003, 30003, 10000, 30000, etc.
 * @param {import('nostr-tools').NostrEvent} listEvent - The list event to modify
 * @param {import('nostr-tools').NostrEvent} itemEvent - The event to remove
 */
export async function removeItemFromList(listEvent, itemEvent) {
  const newTags = listEvent.tags.filter((t) => {
    if (t[0] === 'e' && t[1] === itemEvent.id) return false;
    if (t[0] === 'a') {
      const dTag = itemEvent.tags?.find((it) => it[0] === 'd')?.[1];
      if (dTag !== undefined) {
        const ref = `${itemEvent.kind}:${itemEvent.pubkey}:${dTag}`;
        if (t[1] === ref) return false;
      }
    }
    return true;
  });
  const draft = await factory.modify(listEvent, (event) => ({ ...event, tags: newTags }));
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
 * Whether a bookmark action (add/remove) is in-flight for an event + list.
 * Use to show a spinner while signing/publishing completes.
 * @param {import('nostr-tools').NostrEvent} event
 * @param {string} [identifier] - d-tag of a kind 30003 set, or undefined for default list
 * @returns {boolean}
 */
export function isBookmarkPending(event, identifier) {
  return optimistic.isPending(optimisticKey(event.id, identifier));
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
