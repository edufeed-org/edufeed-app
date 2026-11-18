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
import { buildRankIndex, applyCoordinatorOrder } from '$lib/helpers/educational/searchRank.js';

/**
 * @typedef {import('$lib/helpers/educational/searchQueryBuilder.js').SearchFilters} SearchFilters
 * @typedef {import('nostr-tools').Event} NostrEvent
 *
 * @typedef {object} LearningSearchOptions
 * @property {(filters: SearchFilters, limit: number) => import('rxjs').Observable<{event: NostrEvent, relay: string}>} [loader]
 * @property {() => void} [onActivate] - A search started (the page switches the sort to relevance on the learning tab)
 * @property {() => void} [onDeactivate] - The search ended or failed and its rank is gone (the page leaves relevance sort)
 * @property {((text: string) => Promise<string[] | null>) | null} [coordinator] - Search coordinator: the cross-relay order for a search text as `kind:pubkey:d` addresses, or null. Asked for text-only searches; its answer re-orders the held results once.
 * @property {number} [limit=100] - Results per relay
 * @property {number} [backstopMs=8000] - Spinner backstop; the loader's own request timeout is shorter
 */

/**
 * The search text when the filters hold nothing but text, else null: the
 * coordinator is only asked about plain text searches (a facet narrows the
 * relays' results in ways its order would not reflect).
 *
 * @param {SearchFilters} filters
 * @returns {string | null}
 */
function textOnly(filters) {
  const text = filters.searchText?.trim();
  const facets = [filters.learningResourceType, filters.about, filters.audience].some(
    (list) => list?.length
  );
  const ext = Object.values(filters.extFields ?? {}).some((values) => values?.length);
  return text && !facets && !ext ? text : null;
}

/**
 * @param {LearningSearchOptions} [options]
 */
export function useLearningSearch({
  loader = ambRankedSearchLoader,
  onActivate = () => {},
  onDeactivate = () => {},
  coordinator = null,
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
  /** Identifies the running search: an answer for an earlier one is dropped. */
  let searchToken = 0;
  /** @type {string[] | null} The coordinator's order for the running search, once it answered */
  let coordinatorList = null;

  function cancel() {
    searchToken++;
    subscription?.unsubscribe();
    subscription = null;
    if (backstop) clearTimeout(backstop);
    backstop = null;
  }

  function clear() {
    byRelay = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity -- plain accumulator
    rank = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity -- replaced wholesale
    results = [];
    coordinatorList = null;
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

    // The coordinator interprets the question and merges across relays. Its
    // answer only re-orders what the relays below deliver; without one (off,
    // slow, down, facets set) the per-relay merge stands.
    const text = coordinator ? textOnly(filters) : null;
    if (coordinator && text) {
      const token = searchToken;
      // new Promise(...): also catches a coordinator that throws synchronously
      new Promise((resolve) => resolve(coordinator(text)))
        .then((order) => {
          if (token !== searchToken || !order?.length) return;
          coordinatorList = order;
          rank = applyCoordinatorOrder(rank, order);
        })
        .catch(() => {});
    }

    const seen = new Set(); // eslint-disable-line svelte/prefer-svelte-reactivity -- local accumulator
    subscription = loader(filters, limit).subscribe({
      next: ({ event, relay }) => {
        const list = byRelay.get(relay) ?? [];
        list.push(event);
        byRelay.set(relay, list);
        rank = buildRankIndex([...byRelay.values()]);
        if (coordinatorList) rank = applyCoordinatorOrder(rank, coordinatorList);
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
