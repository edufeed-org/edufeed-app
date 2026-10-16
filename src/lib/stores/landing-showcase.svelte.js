// Live content for the logged-out landing (Claude Design "Landing Round 3",
// 5b): the newest materials, the next Fortbildungen and the newest articles.
// Reuses the cheap loaders /discover runs (they apply curated/WoT authors);
// the models read the EventStore without an author filter, like /discover.
// Disabled discover types are neither loaded nor shown.
import { TimelineModel } from 'applesauce-core/models';
import { ambTimelineLoader } from '$lib/loaders/amb.js';
import { articleTimelineLoader } from '$lib/loaders/articles.js';
import { createDateRangeCalendarLoader } from '$lib/loaders/calendar.js';
import { AMBResourceModel, CalendarEventRangeModel } from '$lib/models';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { unique } from '$lib/helpers/unique.js';
import { isDiscoverTypeEnabled } from '$lib/helpers/discover-content-types.js';
import {
  pickMaterials,
  pickHeroMaterial,
  pickUpcomingEvents,
  pickArticles
} from '$lib/helpers/landing-showcase.js';

/** @typedef {'learning' | 'events' | 'articles'} ShowcaseType */

const EVENT_WINDOW_SECONDS = 60 * 24 * 60 * 60;
// timedPool gives relays 2 s; a loader that never completes must not keep
// a panel in its loading state forever.
const SETTLE_TIMEOUT_MS = 5_000;

export function useLandingShowcase() {
  /** @type {any[]} */
  let resources = $state.raw([]);
  /** @type {any[]} */
  let calendar = $state.raw([]);
  /** @type {any[]} */
  let articleEvents = $state.raw([]);
  /** @type {Record<ShowcaseType, boolean>} */
  let settledByType = $state.raw({ learning: false, events: false, articles: false });

  const nowSec = Math.floor(Date.now() / 1000);

  /** @param {ShowcaseType} type */
  const enabled = (type) => isDiscoverTypeEnabled(type, runtimeConfig.discover?.contentTypes || []);

  /** @param {ShowcaseType} type */
  const markSettled = (type) => {
    if (!settledByType[type]) settledByType = { ...settledByType, [type]: true };
  };

  $effect(() => {
    /** @type {{ unsubscribe(): void }[]} */
    const subs = [];
    /** @type {ShowcaseType[]} */
    const started = [];

    /**
     * @param {ShowcaseType} type
     * @param {() => () => import('rxjs').Observable<any>} makeLoader
     * @param {() => import('rxjs').Observable<any[]>} makeModel
     * @param {(items: any[]) => void} assign
     */
    const start = (type, makeLoader, makeModel, assign) => {
      if (!enabled(type)) {
        assign([]);
        markSettled(type);
        return;
      }
      started.push(type);
      subs.push(
        makeLoader()().subscribe({
          complete: () => markSettled(type),
          error: () => markSettled(type)
        })
      );
      subs.push(makeModel().subscribe((items) => assign(items || [])));
    };

    start(
      'learning',
      () => ambTimelineLoader(12),
      () => /** @type {any} */ (eventStore.model(AMBResourceModel, [])),
      (items) => (resources = items)
    );
    start(
      'events',
      () =>
        createDateRangeCalendarLoader({
          rangeStart: nowSec,
          rangeEnd: nowSec + EVENT_WINDOW_SECONDS
        }),
      () =>
        /** @type {any} */ (
          eventStore.model(CalendarEventRangeModel, nowSec, nowSec + EVENT_WINDOW_SECONDS)
        ),
      (items) => (calendar = items)
    );
    start(
      'articles',
      () => articleTimelineLoader(8),
      () => /** @type {any} */ (eventStore.model(TimelineModel, { kinds: [30023] })),
      (items) => (articleEvents = items)
    );

    const timer = setTimeout(() => started.forEach(markSettled), SETTLE_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
      subs.forEach((s) => s.unsubscribe());
    };
  });

  const materials = $derived(pickMaterials(resources));
  const heroMaterial = $derived(pickHeroMaterial(resources));
  const events = $derived(pickUpcomingEvents(calendar, nowSec));
  const articles = $derived(pickArticles(articleEvents));
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
    authors: () => authors
  };
}
