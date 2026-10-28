// Live content for the logged-out landing (Claude Design "Landing Round 3",
// 5b): the newest materials, the next Fortbildungen and the newest articles —
// but only content BY the accounts on the deployment's showcase lists or
// h-tagged INTO the listed communities (LANDING_SHOWCASE_LISTS, or a panel's
// own LANDING_SHOWCASE_LISTS_<TYPE>). The landing is the deployment's shop
// window: no lists, no live content. Disabled discover types are neither
// loaded nor shown.
import { untrack } from 'svelte';
import { TimelineModel } from 'applesauce-core/models';
import { fetchEvents } from '$lib/loaders/base.js';
import {
  partitionHiddenCalendarSources,
  getHiddenCalendarSourcesVersion
} from '$lib/services/calendar-sources.svelte.js';
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
  // Limits leave room for one item per author (pickMaterials/pickArticles)
  // when a single busy source published the newest dozen.
  learning: { kinds: [30142], limit: 30, relays: getEducationalRelays },
  events: { kinds: [31922, 31923], limit: 30, relays: getCalendarRelays },
  articles: { kinds: [30023], limit: 20, relays: getArticleRelays }
};

/** @param {any[]} filters */
const withoutLimit = (filters) => filters.map(({ limit: _limit, ...rest }) => rest);

// Resolved showcase sources, remembered for the session and across visits
// (one entry per list set): the list fetch waits on relays, and coming back
// to the landing (or a warm cold start) must render from the EventStore at
// once. The lists are refreshed in the background on every visit.
const STORAGE_KEY = 'landing-showcase-sources';
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal bookkeeping, not reactive state
const memorySources = /** @type {Map<string, string[]>} */ (new Map());

/** @returns {{ lists: string[], pubkeys: string[] }[]} */
function storedEntries() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    // a single entry is the format before per-type lists
    return [stored ?? []]
      .flat()
      .filter((e) => Array.isArray(e?.lists) && Array.isArray(e?.pubkeys));
  } catch {
    // private mode / corrupt entry: just fetch
    return [];
  }
}

/** @param {string[]} lists @returns {string[] | null} */
function rememberedSources(lists) {
  const key = lists.join(',');
  const known = memorySources.get(key);
  if (known) return known;
  const entry = storedEntries().find((e) => e.lists.join(',') === key);
  if (!entry) return null;
  memorySources.set(key, entry.pubkeys);
  return entry.pubkeys;
}

/** @param {string[]} lists @param {string[]} pubkeys */
function rememberSources(lists, pubkeys) {
  const key = lists.join(',');
  memorySources.set(key, pubkeys);
  try {
    const others = storedEntries().filter((e) => e.lists.join(',') !== key);
    // a handful of list sets at most; drop the oldest beyond that
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...others, { lists, pubkeys }].slice(-5)));
  } catch {
    // storage unavailable: memory cache still serves this session
  }
}

/** Test hook: forget the remembered sources. */
export function _resetShowcaseSourcesCache() {
  memorySources.clear();
}

/** @type {ShowcaseType[]} */
const TYPES = /** @type {ShowcaseType[]} */ (Object.keys(SOURCES));

/** The lists a panel draws from: its own, else the global ones. */
/** @param {ShowcaseType} type @returns {string[]} */
const listsFor = (type) => {
  const own = runtimeConfig.landing?.showcaseListsByType?.[type] || [];
  return own.length > 0 ? own : runtimeConfig.landing?.showcaseLists || [];
};

export function useLandingShowcase() {
  /** Resolved pubkeys per list set (key: the naddrs joined); absent = resolving */
  /** @type {Record<string, string[]>} */
  let resolved = $state.raw({});
  /** @type {Record<ShowcaseType, any[]>} */
  let raw = $state.raw({ learning: [], events: [], articles: [] });
  /** @type {Record<ShowcaseType, boolean>} */
  let settledByType = $state.raw({ learning: false, events: false, articles: false });

  const nowSec = Math.floor(Date.now() / 1000);

  /** @param {ShowcaseType} type */
  const enabled = (type) => isDiscoverTypeEnabled(type, runtimeConfig.discover?.contentTypes || []);

  /** @param {string[]} lists @returns {string[] | null} null while resolving */
  const sourcesOf = (lists) => (lists.length === 0 ? [] : (resolved[lists.join(',')] ?? null));

  /** @param {string} key @param {string[]} pubkeys */
  const setResolved = (key, pubkeys) => {
    resolved = { ...untrack(() => resolved), [key]: pubkeys };
  };

  // Runs inside the loader effect (disabled types settle synchronously), so it
  // must not make the effect depend on settledByType — every write would
  // restart all loaders.
  /** @param {ShowcaseType} type */
  const markSettled = (type) =>
    untrack(() => {
      if (!settledByType[type]) settledByType = { ...settledByType, [type]: true };
    });

  // 1. Resolve each distinct list set (global + per-type) into source pubkeys
  //    — remembered ones first, then refreshed from the relays (only a
  //    changed list re-renders). Only lists something will show are fetched.
  $effect(() => {
    const global = runtimeConfig.landing?.showcaseLists || [];
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal bookkeeping, not reactive state
    const sets = /** @type {Map<string, string[]>} */ (new Map());
    for (const lists of [global, ...TYPES.filter(enabled).map(listsFor)]) {
      if (lists.length > 0) sets.set(lists.join(','), lists);
    }
    let cancelled = false;
    for (const [key, lists] of sets) {
      const remembered = rememberedSources(lists);
      if (remembered) untrack(() => setResolved(key, remembered));
      loadShowcaseSources(lists)
        .then((pubkeys) => {
          if (cancelled) return;
          // No answer from any relay reads as an empty list — never let that
          // wipe a list we already know.
          if (pubkeys.length === 0 && remembered) return;
          rememberSources(lists, pubkeys);
          if (pubkeys.join(',') !== remembered?.join(',')) setResolved(key, pubkeys);
        })
        .catch(() => {
          if (!cancelled && !remembered) setResolved(key, []);
        });
    }
    return () => {
      cancelled = true;
    };
  });

  // 2. Load each enabled type, restricted to its sources. Re-runs when any
  //    list set resolves; a type whose sources did not change keeps its
  //    loader (see `running`).
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal bookkeeping, not reactive state
  const running = /** @type {Map<ShowcaseType, { key: string, stop: () => void }>} */ (new Map());
  // Stopped on unmount only: a re-run of the loader effect keeps unchanged loaders.
  $effect(() => () => {
    running.forEach((r) => r.stop());
    running.clear();
  });
  $effect(() => {
    for (const type of TYPES) {
      const src = enabled(type) ? sourcesOf(listsFor(type)) : [];
      if (src === null) continue;
      const key = src.join(',');
      if (running.get(type)?.key === key) continue;
      running.get(type)?.stop();

      const { kinds, limit, relays } = SOURCES[type];
      const filters = showcaseFilters(kinds, src, limit);
      if (filters.length === 0) {
        raw = { ...untrack(() => raw), [type]: [] };
        markSettled(type);
        running.set(type, { key, stop: () => {} });
        continue;
      }
      const subs = [
        fetchEvents(relays(), filters).subscribe({ complete: () => markSettled(type) }),
        /** @type {any} */ (eventStore.model(TimelineModel, withoutLimit(filters))).subscribe(
          (/** @type {any[]} */ events) => {
            raw = { ...untrack(() => raw), [type]: events || [] };
          }
        )
      ];
      const timer = setTimeout(() => markSettled(type), SETTLE_TIMEOUT_MS);
      running.set(type, {
        key,
        stop: () => {
          clearTimeout(timer);
          subs.forEach((s) => s.unsubscribe());
        }
      });
    }
  });

  const sources = $derived(sourcesOf(runtimeConfig.landing?.showcaseLists || []));

  const resources = $derived(raw.learning.map((event) => formatAMBResource(event)));
  const materials = $derived(pickMaterials(resources));
  const heroMaterial = $derived(pickHeroMaterial(resources));
  // Bulk sources never make the landing's "next events" (no toggle there)
  const events = $derived.by(() => {
    void getHiddenCalendarSourcesVersion();
    return pickUpcomingEvents(
      partitionHiddenCalendarSources(validateAndTransformCalendarEvents(raw.events)).shown,
      nowSec
    );
  });
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
    /** Global-list pubkeys (community wall); empty until resolved or when unset. */
    sources: () => sources ?? [],
    sourcesResolved: () => sources !== null,
    authors: () => authors
  };
}
