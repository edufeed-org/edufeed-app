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
 * The relays are asked for the hits that fit the question only (`fit:only`).
 * The others are loaded when the user opens the "less fitting" section
 * (`showRest`): they pass the page's gate through `resultIds`, rank behind
 * every fitting hit, and `restIds` tells the page which ones they are.
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
 * @property {(filters: SearchFilters, limit: number, fit?: 'only' | 'rest') => import('rxjs').Observable<{event: NostrEvent, relay: string}>} [loader]
 * @property {() => void} [onActivate] - A search started (the page switches the sort to relevance on the learning tab)
 * @property {() => void} [onDeactivate] - The search ended or failed and its rank is gone (the page leaves relevance sort)
 * @property {((text: string) => Promise<string[] | null>) | null} [coordinator] - Search coordinator: the cross-relay order for a search text as `kind:pubkey:d` addresses, or null. Asked for text-only searches; its answer re-orders the held results once.
 * @property {number} [coordinatorDelayMs=600] - Pause after `apply` before the coordinator is asked: searches fire while the user types, and the coordinator's work runs to completion even when its answer is dropped
 * @property {number} [limit=100] - Results per relay
 * @property {number} [backstopMs=13000] - Spinner backstop; the loader's own request timeout (12 s) is shorter
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

/** Less fitting hits rank behind every fitting one (a relay returns at most 250). */
const REST_RANK_OFFSET = 100000;

/**
 * @param {LearningSearchOptions} [options]
 */
export function useLearningSearch({
  loader = ambRankedSearchLoader,
  onActivate = () => {},
  onDeactivate = () => {},
  coordinator = null,
  coordinatorDelayMs = 600,
  limit = 100,
  backstopMs = 13000
} = {}) {
  let isActive = $state(false);
  let isSearching = $state(false);
  /** @type {NostrEvent[]} */
  let results = $state.raw([]);
  /** Relevance order of the current search: `kind:pubkey:d` → merged position. */
  // Plain Map behind $state.raw: Map methods break through Svelte's deep proxy; replaced wholesale.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  let rank = $state.raw(/** @type {Map<string, number>} */ (new Map()));
  /** The less fitting section was opened for the running search. */
  let restShown = $state(false);
  let isLoadingRest = $state(false);
  /** @type {NostrEvent[]} Hits the relays held back as less fitting */
  let restResults = $state.raw([]);
  /** A text search is running: the relays judged it, so there is a rest to ask for. */
  let canShowRest = $state(false);
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived snapshot, never mutated
  const restIds = $derived(new Set(restResults.map((e) => e.id)));
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived snapshot, never mutated
  const resultIds = $derived(new Set([...results, ...restResults].map((e) => e.id)));
  /** The fitting hits' order, then the less fitting ones behind all of them. */
  const combinedRank = $derived.by(() => {
    if (restRank.size === 0) return rank;
    const combined = new Map(rank); // eslint-disable-line svelte/prefer-svelte-reactivity -- derived snapshot
    for (const [key, position] of restRank) {
      if (!combined.has(key)) combined.set(key, REST_RANK_OFFSET + position);
    }
    return combined;
  });

  /** @type {Map<string, NostrEvent[]>} relay → relevance-ordered results (plain accumulator) */
  let byRelay = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity -- rank is the reactive projection
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- replaced wholesale
  let restRank = $state.raw(/** @type {Map<string, number>} */ (new Map()));
  /** @type {import('rxjs').Subscription | null} */
  let subscription = null;
  /** @type {import('rxjs').Subscription | null} */
  let restSubscription = null;
  /** @type {SearchFilters | null} The running search's filters, for the rest request */
  let currentFilters = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let backstop = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let coordinatorTimer = null;
  /** Identifies the running search: an answer for an earlier one is dropped. */
  let searchToken = 0;
  /** @type {string[] | null} The coordinator's order for the running search, once it answered */
  let coordinatorList = null;

  function cancel() {
    searchToken++;
    subscription?.unsubscribe();
    subscription = null;
    restSubscription?.unsubscribe();
    restSubscription = null;
    if (backstop) clearTimeout(backstop);
    backstop = null;
    if (coordinatorTimer) clearTimeout(coordinatorTimer);
    coordinatorTimer = null;
  }

  function clear() {
    byRelay = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity -- plain accumulator
    rank = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity -- replaced wholesale
    results = [];
    coordinatorList = null;
    restShown = false;
    isLoadingRest = false;
    restResults = [];
    restRank = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity -- replaced wholesale
    canShowRest = false;
    currentFilters = null;
  }

  /** Load the hits the relays held back as less fitting (once per search). */
  function showRest() {
    if (!isActive || !canShowRest || restShown || !currentFilters) return;
    restShown = true;
    isLoadingRest = true;
    const byRelayRest = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity -- local accumulator
    restSubscription = loader(currentFilters, limit, 'rest').subscribe({
      next: ({ event, relay }) => {
        // A hit one relay holds back and another counts as fitting stays fitting.
        if (results.some((e) => e.id === event.id)) return;
        const list = byRelayRest.get(relay) ?? [];
        list.push(event);
        byRelayRest.set(relay, list);
        restRank = buildRankIndex([...byRelayRest.values()]);
        if (!restResults.some((e) => e.id === event.id)) restResults = [...restResults, event];
      },
      error: () => {
        isLoadingRest = false; // the fitting hits stay; the section shows what arrived
      },
      complete: () => {
        isLoadingRest = false;
      }
    });
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
    currentFilters = filters;
    canShowRest = !!filters.searchText?.trim();
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
      coordinatorTimer = setTimeout(() => {
        coordinatorTimer = null;
        // new Promise(...): also catches a coordinator that throws synchronously
        new Promise((resolve) => resolve(coordinator(text)))
          .then((order) => {
            if (token !== searchToken || !order?.length) return;
            coordinatorList = order;
            rank = applyCoordinatorOrder(rank, order);
          })
          .catch(() => {});
      }, coordinatorDelayMs);
    }

    const seen = new Set(); // eslint-disable-line svelte/prefer-svelte-reactivity -- local accumulator
    subscription = loader(filters, limit, canShowRest ? 'only' : undefined).subscribe({
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
      return combinedRank;
    },
    /** A text search is running: the less fitting section can be offered. */
    get canShowRest() {
      return canShowRest;
    },
    get restShown() {
      return restShown;
    },
    get isLoadingRest() {
      return isLoadingRest;
    },
    /** Event ids of the less fitting hits (empty until `showRest`). */
    get restIds() {
      return restIds;
    },
    apply,
    showRest,
    /** Leave search mode (switching away from the learning tab). */
    stop: deactivate
  };
}
