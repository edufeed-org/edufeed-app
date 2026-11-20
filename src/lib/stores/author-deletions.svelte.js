/**
 * Reactive hook: learn about the NIP-09 deletions of the authors currently on
 * screen.
 *
 * The gap this closes: nothing in the app ever fetched OTHER people's kind-5s.
 * `fetchUserDeletions` is called only by the calendar paths and only for the
 * active user; `hydrateDeletions()` (event-cache) replays kind-5s already in
 * IDB but never asks for new ones. So a resource its author deleted kept
 * rendering for whoever held a stale copy, and stayed shareable — a repost was
 * published against a resource deleted 17 days earlier, and no other user could
 * resolve it (laoc, 2026-08-24).
 *
 * Feeding the eventStore is the entire contract. applesauce's DeleteManager
 * removes the deleted events from every `TimelineModel` on its own, so this
 * hook returns nothing: callers just instantiate it beside their content
 * subscription, the way they already instantiate `useProfileMap`.
 *
 * Ask-once semantics, like channel-rosters.svelte.js: a caller's pubkey list is
 * rebuilt on every unrelated re-render, and one fresh REQ per render is what
 * starves a relay connection. Only pubkeys never asked about produce a request.
 * Deletions accumulate but never un-happen, so not re-asking costs nothing that
 * a page load doesn't recover.
 *
 * MUST be called during component init (it uses $effect).
 */
/* eslint-disable svelte/prefer-svelte-reactivity -- plain bookkeeping + accumulator, never rendered */
import { fetchAuthorsDeletions, fetchDeletionsOf } from '$lib/loaders/base.js';

const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * @param {() => Iterable<string>} getPubkeys - Reactive getter for the authors
 *   whose deletions matter right now (content authors AND sharers — a repost
 *   points at someone else's event).
 * @returns {void}
 */
export function useAuthorDeletions(getPubkeys) {
  /** Pubkeys already requested by THIS hook instance. */
  const asked = new Set();
  /** @type {import('rxjs').Subscription[]} */
  const subscriptions = [];

  $effect(() => {
    /** @type {string[]} */
    const fresh = [];
    for (const pubkey of getPubkeys() ?? []) {
      // Untrusted: these come off event tags. A malformed value would widen
      // the filter rather than narrow it, so it is dropped, not passed on.
      if (typeof pubkey !== 'string' || !HEX64.test(pubkey)) continue;
      if (asked.has(pubkey)) continue;
      asked.add(pubkey);
      fresh.push(pubkey);
    }
    if (fresh.length === 0) return;
    subscriptions.push(fetchAuthorsDeletions(fresh).subscribe({ error: () => {} }));
  });

  $effect(() => {
    return () => {
      for (const sub of subscriptions) sub.unsubscribe();
      subscriptions.length = 0;
      asked.clear();
    };
  });
}

/**
 * Reactive hook: learn about the NIP-09 deletions of the CONTENT currently on
 * screen. The form to use for lists of events; `useAuthorDeletions` remains
 * for lists of people.
 *
 * It asks which deletions name the events themselves, not for every deletion
 * of their authors: an author can be a bulk importer (see `fetchDeletionsOf`).
 * Two kinds of item still go by author, where that is cheap and the only way:
 * the people who shared an item (`_sharedBy` / `_allSharers`: their repost is
 * not at hand, only their key), and an item that is not an event but carries
 * a `pubkey` (a community).
 *
 * Ask-once per event, for the reason given above.
 *
 * MUST be called during component init (it uses $effect).
 *
 * @param {() => Iterable<any>} getItems - Reactive getter for the events on
 *   screen, or models that carry theirs as `.event`.
 * @returns {void}
 */
export function useContentDeletions(getItems) {
  /** Event ids already asked about by THIS hook instance. */
  const asked = new Set();
  /** @type {import('rxjs').Subscription[]} */
  const subscriptions = [];
  /** @type {string[]} people to ask about by author; read by useAuthorDeletions below */
  let people = $state.raw([]);

  $effect(() => {
    /** @type {any[]} */
    const fresh = [];
    /** @type {string[]} */
    const authors = [];
    for (const item of getItems() ?? []) {
      if (!item || typeof item !== 'object') continue;
      if (item._allSharers) authors.push(...item._allSharers);
      else if (item._sharedBy) authors.push(item._sharedBy);
      const event = item.event ?? item;
      // Untrusted shapes: only a real event id goes into a filter.
      if (
        typeof event?.id !== 'string' ||
        !HEX64.test(event.id) ||
        typeof event.kind !== 'number'
      ) {
        if (item.pubkey) authors.push(item.pubkey);
        continue;
      }
      if (asked.has(event.id)) continue;
      asked.add(event.id);
      fresh.push(event);
    }
    if (authors.length !== people.length || authors.some((pubkey, i) => pubkey !== people[i])) {
      people = authors;
    }
    if (fresh.length === 0) return;
    subscriptions.push(fetchDeletionsOf(fresh).subscribe({ error: () => {} }));
  });

  useAuthorDeletions(() => people);

  $effect(() => {
    return () => {
      for (const sub of subscriptions) sub.unsubscribe();
      subscriptions.length = 0;
      asked.clear();
    };
  });
}
