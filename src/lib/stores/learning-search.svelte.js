/**
 * useLearningSearch — the discover page's NIP-50 learning search.
 *
 * A search is one ranked stream per relay (`ambRankedSearchLoader`): each
 * relay ranks its own response and scores are not comparable across relays,
 * so the per-relay order is kept and merged by rank into `rank`
 * (`searchRank.js`). Events land in the EventStore through the loader; this
 * hook only tracks which ids the search returned, their relevance order, and
 * whether the relays have answered yet (`isSearching` gates the empty state
 * so "no results" does not flash before the first reply).
 *
 * Call during component initialisation (it registers a cleanup effect).
 */
import { ambRankedSearchLoader } from '$lib/loaders/amb-search.js';
import { hasActiveFilters } from '$lib/helpers/educational/searchQueryBuilder.js';
import { buildRankIndex } from '$lib/helpers/educational/searchRank.js';

/**
 * @typedef {import('$lib/helpers/educational/searchQueryBuilder.js').SearchFilters} SearchFilters
 * @typedef {import('nostr-tools').Event} NostrEvent
 *
 * @typedef {object} LearningSearchOptions
 * @property {(filters: SearchFilters, limit: number) => import('rxjs').Observable<{event: NostrEvent, relay: string}>} [loader]
 * @property {() => void} [onActivate] - A search started (the page switches the sort to relevance on the learning tab)
 * @property {() => void} [onDeactivate] - The search ended or failed and its rank is gone (the page leaves relevance sort)
 * @property {number} [limit=100] - Results per relay
 * @property {number} [backstopMs=8000] - Spinner backstop; the loader's own request timeout is shorter
 */

/**
 * @param {LearningSearchOptions} [options]
 */
export function useLearningSearch({
  loader = ambRankedSearchLoader,
  onActivate = () => {},
  onDeactivate = () => {},
  limit = 100,
  backstopMs = 8000
} = {}) {
  let isActive = $state(false);
  let isSearching = $state(false);
  /** @type {NostrEvent[]} */
  let results = $state.raw([]);
  /** Relevance order of the current search: `kind:pubkey:d` → merged position. */
  // Plain Map behind $state.raw: Map methods break through Svelte's deep proxy; replaced wholesale.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  let rank = $state.raw(/** @type {Map<string, number>} */ (new Map()));
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived snapshot, never mutated
  const resultIds = $derived(new Set(results.map((e) => e.id)));

  /** @type {Map<string, NostrEvent[]>} relay → relevance-ordered results (plain accumulator) */
  let byRelay = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity -- rank is the reactive projection
  /** @type {import('rxjs').Subscription | null} */
  let subscription = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let backstop = null;

  function cancel() {
    subscription?.unsubscribe();
    subscription = null;
    if (backstop) clearTimeout(backstop);
    backstop = null;
  }

  function clear() {
    byRelay = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity -- plain accumulator
    rank = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity -- replaced wholesale
    results = [];
  }

  function deactivate() {
    cancel();
    isActive = false;
    isSearching = false;
    clear();
    onDeactivate();
  }

  /**
   * Run the search for `filters`, or leave search mode when they are empty.
   * @param {SearchFilters} filters
   */
  function apply(filters) {
    cancel();
    if (!hasActiveFilters(filters)) {
      deactivate();
      return;
    }
    isActive = true;
    clear();
    isSearching = true;
    onActivate();
    backstop = setTimeout(() => {
      isSearching = false;
    }, backstopMs);

    const seen = new Set(); // eslint-disable-line svelte/prefer-svelte-reactivity -- local accumulator
    subscription = loader(filters, limit).subscribe({
      next: ({ event, relay }) => {
        const list = byRelay.get(relay) ?? [];
        list.push(event);
        byRelay.set(relay, list);
        rank = buildRankIndex([...byRelay.values()]);
        if (!seen.has(event.id)) {
          seen.add(event.id);
          results = [...results, event];
        }
      },
      error: (error) => {
        console.error('🔍 Learning search error:', error);
        deactivate();
      },
      complete: () => {
        isSearching = false;
        if (backstop) clearTimeout(backstop);
        backstop = null;
      }
    });
  }

  $effect(() => () => cancel());

  return {
    get isActive() {
      return isActive;
    },
    get isSearching() {
      return isSearching;
    },
    get results() {
      return results;
    },
    get resultIds() {
      return resultIds;
    },
    get rank() {
      return rank;
    },
    apply,
    /** Leave search mode (switching away from the learning tab). */
    stop: deactivate
  };
}
