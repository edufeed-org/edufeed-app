/**
 * Content of people the /discover user is looking for — members a search
 * matched by name, and authors picked in the author filter. The page mostly
 * filters what the feeds already loaded, so their older work (or anything a
 * curated feed never asked for) would simply be missing; this asks each shown
 * type's app relays for it once per author. Events land in the EventStore,
 * where the page's models pick them up.
 *
 * MUST be called during component init (it uses $effect).
 */
import { untrack } from 'svelte';
import { fetchEvents } from '$lib/loaders/base.js';
import { tagVariants } from '$lib/helpers/hashtags.js';
import {
  getCalendarRelays,
  getEducationalRelays,
  getArticleRelays,
  getKanbanRelays
} from '$lib/helpers/relay-helper.js';

/** Per member and kind; enough for a person's own work, not a feed. */
const PER_AUTHOR_LIMIT = 50;
/** Per tag and kind: a filtered list, not a feed. */
const PER_TAG_LIMIT = 100;

const SOURCES = [
  { type: 'events', kinds: [31922, 31923], getRelays: getCalendarRelays },
  { type: 'learning', kinds: [30142], getRelays: getEducationalRelays },
  { type: 'articles', kinds: [30023, 30146], getRelays: getArticleRelays },
  { type: 'boards', kinds: [30301], getRelays: getKanbanRelays }
];

/**
 * Ask each shown type's relays once per key (an author, a tag). Requests keep
 * running when the keys change: a key is asked once and never again, so
 * cancelling would lose the answer.
 * @param {() => string[]} getKeys - reactive
 * @param {(key: string) => string} idOf - when two keys are the same question
 * @param {(fresh: string[]) => object} toFilter - the filter beside `kinds`
 * @param {(type: string) => boolean} showsType
 */
function useAskOnce(getKeys, idOf, toFilter, showsType) {
  // Plain refs, never $state: bookkeeping the effect must not track.
  /** @type {Set<string>} */
  const asked = new Set(); // eslint-disable-line svelte/prefer-svelte-reactivity -- internal bookkeeping
  /** @type {import('rxjs').Subscription[]} */
  const subs = [];

  $effect(() => {
    const fresh = [...new Map(getKeys().map((k) => [idOf(k), k])).entries()]
      .filter(([id]) => !asked.has(id))
      .map(([, k]) => k);
    if (fresh.length === 0) return;
    untrack(() => {
      for (const k of fresh) asked.add(idOf(k));
      for (const { type, kinds, getRelays } of SOURCES) {
        if (!showsType(type)) continue;
        subs.push(fetchEvents(getRelays(), { kinds, ...toFilter(fresh) }).subscribe());
      }
    });
  });

  $effect(() => () => {
    for (const sub of subs) sub.unsubscribe();
  });
}

/**
 * @param {() => string[]} getAuthors - pubkeys to fetch content of (reactive)
 * @param {{ showsType: (type: string) => boolean }} options
 */
export function useAuthorContent(getAuthors, { showsType }) {
  useAskOnce(
    getAuthors,
    (pk) => pk,
    (fresh) => ({ authors: fresh, limit: PER_AUTHOR_LIMIT * fresh.length }),
    showsType
  );
}

/**
 * Content carrying the tags picked in the /discover tag filter, the same way:
 * the feeds only hold their latest window, so older tagged items would be
 * missing. Once per tag, whatever its case.
 * @param {() => string[]} getTags - reactive
 * @param {{ showsType: (type: string) => boolean }} options
 */
export function useTagContent(getTags, { showsType }) {
  useAskOnce(
    getTags,
    (tag) => tag.toLowerCase(),
    (fresh) => ({ '#t': fresh.flatMap(tagVariants), limit: PER_TAG_LIMIT * fresh.length }),
    showsType
  );
}
