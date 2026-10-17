// Live content for the logged-out landing (Claude Design "Landing Round 3",
// 5b): the newest materials, the next Fortbildungen and the newest articles —
// but only content BY the accounts on the deployment's showcase lists or
// h-tagged INTO the listed communities (LANDING_SHOWCASE_LISTS). The landing
// is the deployment's shop window: no lists, no live content. Disabled
// discover types are neither loaded nor shown.
import { untrack } from 'svelte';
import { TimelineModel } from 'applesauce-core/models';
import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { timedPool } from '$lib/loaders/base.js';
import { loadShowcaseSources } from '$lib/loaders/landing-showcase-sources.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import {
  getEducationalRelays,
  getCalendarRelays,
  getArticleRelays
} from '$lib/helpers/relay-helper.js';
import { unique } from '$lib/helpers/unique.js';
import { isDiscoverTypeEnabled } from '$lib/helpers/discover-content-types.js';
import { formatAMBResource } from '$lib/helpers/educational/index.js';
import { validateAndTransformCalendarEvents } from '$lib/helpers/eventUtils.js';
import {
  pickMaterials,
  pickHeroMaterial,
  pickUpcomingEvents,
  pickArticles,
  showcaseFilters
} from '$lib/helpers/landing-showcase.js';

/** @typedef {'learning' | 'events' | 'articles'} ShowcaseType */

// timedPool gives relays 2 s; a loader that never completes must not keep
// a panel in its loading state forever.
const SETTLE_TIMEOUT_MS = 5_000;

/** @type {Record<ShowcaseType, { kinds: number[], limit: number, relays: () => string[] }>} */
const SOURCES = {
  learning: { kinds: [30142], limit: 12, relays: getEducationalRelays },
  events: { kinds: [31922, 31923], limit: 30, relays: getCalendarRelays },
  articles: { kinds: [30023], limit: 8, relays: getArticleRelays }
};

/** @param {any[]} filters */
const withoutLimit = (filters) => filters.map(({ limit: _limit, ...rest }) => rest);

export function useLandingShowcase() {
  /** null while the showcase lists are still resolving */
  /** @type {string[] | null} */
  let sources = $state.raw(null);
  /** @type {Record<ShowcaseType, any[]>} */
  let raw = $state.raw({ learning: [], events: [], articles: [] });
  /** @type {Record<ShowcaseType, boolean>} */
  let settledByType = $state.raw({ learning: false, events: false, articles: false });

  const nowSec = Math.floor(Date.now() / 1000);

  /** @param {ShowcaseType} type */
  const enabled = (type) => isDiscoverTypeEnabled(type, runtimeConfig.discover?.contentTypes || []);

  // Runs inside the loader effect (disabled types settle synchronously), so it
  // must not make the effect depend on settledByType — every write would
  // restart all loaders.
  /** @param {ShowcaseType} type */
  const markSettled = (type) =>
    untrack(() => {
      if (!settledByType[type]) settledByType = { ...settledByType, [type]: true };
    });

  // 1. Resolve the showcase lists into source pubkeys.
  $effect(() => {
    const lists = runtimeConfig.landing?.showcaseLists || [];
    if (lists.length === 0) {
      sources = [];
      return;
    }
    let cancelled = false;
    loadShowcaseSources(lists)
      .then((pubkeys) => !cancelled && (sources = pubkeys))
      .catch(() => !cancelled && (sources = []));
    return () => {
      cancelled = true;
    };
  });

  // 2. Load each enabled type, restricted to the sources.
  $effect(() => {
    const src = sources;
    if (src === null) return;

    /** @type {{ unsubscribe(): void }[]} */
    const subs = [];
    /** @type {ShowcaseType[]} */
    const started = [];

    for (const type of /** @type {ShowcaseType[]} */ (Object.keys(SOURCES))) {
      const { kinds, limit, relays } = SOURCES[type];
      const filters = showcaseFilters(kinds, src, limit);
      if (!enabled(type) || filters.length === 0) {
        raw = { ...untrack(() => raw), [type]: [] };
        markSettled(type);
        continue;
      }
      started.push(type);
      const load = createTimelineLoader(timedPool, relays(), filters, { eventStore });
      subs.push(
        load().subscribe({ complete: () => markSettled(type), error: () => markSettled(type) })
      );
      subs.push(
        /** @type {any} */ (eventStore.model(TimelineModel, withoutLimit(filters))).subscribe(
          (/** @type {any[]} */ events) => {
            raw = { ...untrack(() => raw), [type]: events || [] };
          }
        )
      );
    }

    const timer = setTimeout(() => started.forEach(markSettled), SETTLE_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
      subs.forEach((s) => s.unsubscribe());
    };
  });

  const resources = $derived(raw.learning.map((event) => formatAMBResource(event)));
  const materials = $derived(pickMaterials(resources));
  const heroMaterial = $derived(pickHeroMaterial(resources));
  const events = $derived(
    pickUpcomingEvents(validateAndTransformCalendarEvents(raw.events), nowSec)
  );
  const articles = $derived(pickArticles(raw.articles));
  const authors = $derived(
    unique(
      [...materials, heroMaterial, ...events, ...articles]
        .filter(Boolean)
        .map((item) => item.pubkey)
    )
  );

  return {
    materials: () => materials,
    heroMaterial: () => heroMaterial,
    events: () => events,
    articles: () => articles,
    /** @param {ShowcaseType} type */
    settled: (type) => settledByType[type],
    /** Pubkeys allowed on the landing; empty until resolved or when unset. */
    sources: () => sources ?? [],
    sourcesResolved: () => sources !== null,
    authors: () => authors
  };
}
