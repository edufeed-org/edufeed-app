/**
 * Content of deployment members a search matched by name. The /discover
 * search mostly filters what the feeds already loaded, so a member's older
 * work would simply be missing; this asks each shown type's app relays for
 * it once per member. Events land in the EventStore, where the page's models
 * pick them up and `tierByMembers` ranks them on top.
 *
 * MUST be called during component init (it uses $effect).
 */
import { untrack } from 'svelte';
import { fetchEvents } from '$lib/loaders/base.js';
import {
  getCalendarRelays,
  getEducationalRelays,
  getArticleRelays,
  getKanbanRelays
} from '$lib/helpers/relay-helper.js';

/** Per member and kind; enough for a person's own work, not a feed. */
const PER_AUTHOR_LIMIT = 50;

const SOURCES = [
  { type: 'events', kinds: [31922, 31923], getRelays: getCalendarRelays },
  { type: 'learning', kinds: [30142], getRelays: getEducationalRelays },
  { type: 'articles', kinds: [30023], getRelays: getArticleRelays },
  { type: 'boards', kinds: [30301], getRelays: getKanbanRelays }
];

/**
 * @param {() => string[]} getAuthors - matched member pubkeys (reactive)
 * @param {{ showsType: (type: string) => boolean }} options
 */
export function useMemberContent(getAuthors, { showsType }) {
  // Plain refs, never $state: bookkeeping the effect must not track.
  /** @type {Set<string>} */
  const asked = new Set(); // eslint-disable-line svelte/prefer-svelte-reactivity -- internal bookkeeping
  /** @type {import('rxjs').Subscription[]} */
  const subs = [];

  $effect(() => {
    const fresh = getAuthors().filter((pk) => !asked.has(pk));
    if (fresh.length === 0) return;
    untrack(() => {
      for (const pk of fresh) asked.add(pk);
      for (const { type, kinds, getRelays } of SOURCES) {
        if (!showsType(type)) continue;
        // Kept running when the match changes: the member was asked once and
        // will not be asked again, so cancelling would lose the answer.
        subs.push(
          fetchEvents(getRelays(), {
            kinds,
            authors: fresh,
            limit: PER_AUTHOR_LIMIT * fresh.length
          }).subscribe()
        );
      }
    });
  });

  $effect(() => () => {
    for (const sub of subs) sub.unsubscribe();
  });
}
