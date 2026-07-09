/**
 * Calendar Event Loader - Composable Hook
 * Unified interface for loading calendar events from various sources
 * Follows the project's EventStore intelligence pattern
 */

import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
import { TimelineModel } from 'applesauce-core/models';
import { onlyEvents } from 'applesauce-relay/operators';
import { mapEventsToStore, mapEventsToTimeline } from 'applesauce-core/observable';
import { map } from 'rxjs';
import { getTagValue } from 'applesauce-core/helpers';
import { getCalendarEventMetadata, parseAddressReference } from '$lib/helpers/eventUtils';
import { calendarTimelineLoader } from '$lib/loaders/calendar.js';
import { communityTargetedPublicationsLoader } from '$lib/loaders/targeted-publications.js';
import { userDeletionLoader, addressLoader } from '$lib/loaders/base.js';
import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { applyCuratedFilter } from '$lib/services/curated-authors-service.svelte.js';
import { calendarFilters } from '$lib/stores/calendar-filters.svelte.js';
import { parseCalendarFilters } from '$lib/helpers/urlParams.js';
import { CommunityCalendarEventModel } from '$lib/models';

/**
 * @typedef {Object} LoaderOptions
 * @property {(events: any[]) => void} onEventsUpdate - Callback when events update
 * @property {(loading: boolean) => void} onLoadingChange - Callback when loading state changes
 * @property {(error: string | null) => void} onError - Callback when error occurs
 * @property {(errors: string[]) => void} [onResolutionErrors] - Optional callback for resolution errors
 */

/**
 * @typedef {Object} EventLoaderAPI
 * @property {(relays?: string[], authors?: string[]) => void} loadGlobal - Load global events
 * @property {(calendar: any) => void} loadByCalendar - Load calendar-specific events
 * @property {(pubkey: string, relays?: string[]) => void} loadByAuthor - Load events by author
 * @property {(pubkey: string) => void} loadByCommunity - Load community events
 * @property {(relays: string[], authors?: string[]) => void} loadByRelays - Load from specific relays
 * @property {() => void} cleanup - Clean up all subscriptions
 */

/**
 * Create a calendar event loader with unified loading interface
 * @param {LoaderOptions} options - Configuration options
 * @returns {EventLoaderAPI}
 */
export function useCalendarEventLoader(options) {
  // Subscription management
  /** @type {import('rxjs').Subscription | undefined} */
  let subscription;
  /** @type {import('rxjs').Subscription | undefined} */
  let relaySubscription;
  /** @type {import('rxjs').Subscription | undefined} */
  let backgroundLoaderSubscription;
  /** @type {import('rxjs').Subscription | undefined} */
  let targetedPublicationSubscription;
  /** @type {Map<string, any>} */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal bookkeeping, not reactive state
  let deletionSubscriptions = new Map();

  // Internal state
  /** @type {Map<string, any>} */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal bookkeeping, not reactive state
  const eventMap = new Map();
  /** @type {string[]} */
  const resolutionErrors = [];

  /**
   * Clean up a specific subscription
   * @param {any} sub
   */
  function cleanupSubscription(sub) {
    if (sub) {
      sub.unsubscribe();
    }
    return undefined;
  }

  /**
   * Clean up all subscriptions
   */
  function cleanupAll() {
    subscription = cleanupSubscription(subscription);
    relaySubscription = cleanupSubscription(relaySubscription);
    backgroundLoaderSubscription = cleanupSubscription(backgroundLoaderSubscription);
    targetedPublicationSubscription = cleanupSubscription(targetedPublicationSubscription);

    // Clean up deletion subscriptions
    deletionSubscriptions.forEach((sub) => cleanupSubscription(sub));
    deletionSubscriptions.clear();

    eventMap.clear();
    resolutionErrors.length = 0;
  }

  /**
   * Start loading deletion events for author pubkeys in parallel
   * This MUST be called before or simultaneously with event loading
   * so EventStore can filter deleted events automatically
   * @param {string[]} pubkeys - Array of author pubkeys
   */
  function startDeletionLoaders(pubkeys) {
    pubkeys.forEach((pubkey) => {
      // Skip if already loading deletions for this author
      if (deletionSubscriptions.has(pubkey)) {
        return;
      }

      const deletionLoader = userDeletionLoader(pubkey);
      const loaderResult = deletionLoader();

      // Handle both Observable and Promise returns
      if (loaderResult && typeof loaderResult.subscribe === 'function') {
        const sub = loaderResult.subscribe({
          error: (/** @type {any} */ err) => {
            console.error('❌ DELETION LOADER ERROR for', pubkey.substring(0, 8), '...:', err);
          }
        });
        deletionSubscriptions.set(pubkey, sub);
      } else {
        console.error('❌ DELETION LOADER: Loader result is not subscribable!', loaderResult);
      }
    });
  }

  /**
   * Start background loader
   */
  function startBackgroundLoader() {
    if (!backgroundLoaderSubscription) {
      backgroundLoaderSubscription = calendarTimelineLoader()().subscribe();
    }
  }

  /**
   * Stop background loader
   */
  function stopBackgroundLoader() {
    if (backgroundLoaderSubscription) {
      backgroundLoaderSubscription = cleanupSubscription(backgroundLoaderSubscription);
    }
  }

  /**
   * Load global events using EventStore
   * @param {string[]} [relays] - Optional relay URLs to use
   * @param {string[]} [authors] - Optional author pubkeys to filter by
   */
  function loadGlobal(relays, authors) {
    const selectedRelays = relays || [];
    const selectedAuthors = authors || [];

    options.onLoadingChange(true);
    eventMap.clear();

    // If relay filtering OR author filtering is active, use pool.subscription
    if (selectedRelays.length > 0 || selectedAuthors.length > 0) {
      // Stop other subscriptions
      relaySubscription = cleanupSubscription(relaySubscription);
      stopBackgroundLoader();

      // Use default relays from config if no specific relays selected
      const relaysToUse =
        selectedRelays.length > 0
          ? selectedRelays
          : [...(runtimeConfig.appRelays?.calendar || []), ...(runtimeConfig.fallbackRelays || [])];
      loadByRelays(relaysToUse, selectedAuthors);
    } else {
      // Default behavior: use EventStore model
      relaySubscription = cleanupSubscription(relaySubscription);
      startBackgroundLoader();

      const filter = applyCuratedFilter({ kinds: [31922, 31923], limit: 50 });

      subscription = eventStore.model(TimelineModel, filter).subscribe((timeline) => {
        // Start deletion loaders for all visible event authors (parallel pattern)
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- ephemeral dedup, not reactive state
        const authorPubkeys = [...new Set(timeline.map((e) => e.pubkey))];
        startDeletionLoaders(authorPubkeys);

        const mapped = timeline.map(getCalendarEventMetadata);
        options.onEventsUpdate(mapped);
        options.onLoadingChange(false);
      });
    }
  }

  /**
   * Load events from specific calendar
   * @param {any} calendar - Calendar object with eventReferences
   */
  function loadByCalendar(calendar) {
    if (!calendar) {
      console.warn('📅 EventLoader: No calendar provided');
      return;
    }

    if (!calendar.eventReferences || calendar.eventReferences.length === 0) {
      options.onEventsUpdate([]);
      return;
    }

    options.onLoadingChange(true);
    eventMap.clear();

    // Stop other subscriptions
    relaySubscription = cleanupSubscription(relaySubscription);
    stopBackgroundLoader();

    // Collect all author pubkeys from calendar references for parallel deletion loading
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- ephemeral dedup, not reactive state
    const authorPubkeys = new Set();

    calendar.eventReferences.forEach((/** @type {string} */ addressRef) => {
      const parsed = parseAddressReference(addressRef);

      if (!parsed) {
        console.warn('📅 EventLoader: Invalid address reference:', addressRef);
        return;
      }

      // Collect author pubkey for deletion loader
      authorPubkeys.add(parsed.pubkey);

      addressLoader({
        kind: parsed.kind,
        pubkey: parsed.pubkey,
        identifier: parsed.dTag
      }).subscribe((/** @type {any} */ event) => {
        const calendarEvent = getCalendarEventMetadata(event);

        if (!eventMap.has(calendarEvent.id)) {
          eventMap.set(calendarEvent.id, calendarEvent);
          options.onEventsUpdate(Array.from(eventMap.values()));
        }
      });
    });

    // Start deletion loaders for all authors at once (parallel pattern)
    if (authorPubkeys.size > 0) {
      startDeletionLoaders([...authorPubkeys]);
    }
  }

  /**
   * Load events by author
   * @param {string} pubkey - The author's public key
   * @param {string[]} [relays] - Optional relay URLs to use
   */
  function loadByAuthor(pubkey, relays) {
    const selectedRelays = relays || [];

    options.onLoadingChange(true);
    eventMap.clear();

    // Start deletion loader FIRST (parallel pattern, before any subscriptions)
    startDeletionLoaders([pubkey]);

    if (selectedRelays.length > 0) {
      // Use specific relays
      relaySubscription = cleanupSubscription(relaySubscription);

      relaySubscription = pool
        .subscription(selectedRelays, {
          kinds: [31922, 31923],
          authors: [pubkey],
          limit: 50
        })
        .pipe(
          onlyEvents(),
          mapEventsToStore(eventStore),
          mapEventsToTimeline(),
          map((timeline) => [...timeline])
        )
        .subscribe({
          next: (timeline) => {
            const mapped = timeline.map(getCalendarEventMetadata);
            options.onEventsUpdate(mapped);
            options.onLoadingChange(false);
          },
          error: (err) => {
            console.error('📅 EventLoader: Relay subscription error:', err);
            options.onError('Failed to load events from relays');
            options.onLoadingChange(false);
          }
        });
    } else {
      // Use EventStore
      relaySubscription = cleanupSubscription(relaySubscription);

      const filter = { kinds: [31922, 31923], authors: [pubkey], limit: 50 };

      subscription = eventStore.model(TimelineModel, filter).subscribe((timeline) => {
        const mapped = timeline.map(getCalendarEventMetadata);
        options.onEventsUpdate(mapped);
        options.onLoadingChange(false);
      });
    }
  }

  /**
   * Load community events using the CommunityCalendarEventModel
   * @param {string} communityPubkey - The community's public key
   */
  function loadByCommunity(communityPubkey) {
    if (!communityPubkey) {
      console.warn('📅 EventLoader: No communityPubkey provided for community mode');
      return;
    }

    options.onLoadingChange(true);
    options.onError(null);
    eventMap.clear();

    // Clean up all subscriptions
    cleanupAll();

    try {
      // Start loaders to populate EventStore with required data
      // 1. Direct community events (kinds 31922, 31923 with h-tag)
      backgroundLoaderSubscription = eventStore
        .timeline({
          kinds: [31922, 31923],
          '#h': [communityPubkey],
          limit: 50
        })
        .subscribe();

      // 2. Targeted publications (kind 30222 referencing community)
      targetedPublicationSubscription = communityTargetedPublicationsLoader(
        communityPubkey,
        [31922, 31923]
      )().subscribe();

      // 2b. NIP-18 reposts (kind 6/16 with h-tag) sharing calendar events into
      // the community — fetched from relays so shares reconstruct on a fresh
      // load instead of only appearing in the sharer's own session.
      const repostRelayLoaderSubscription = createTimelineLoader(
        pool,
        getAllLookupRelays(),
        { kinds: [6, 16], '#h': [communityPubkey], limit: 50 },
        { eventStore, limit: 50 }
      )().subscribe({
        error: (/** @type {any} */ err) =>
          console.warn('📅 EventLoader: Community repost loader error:', err)
      });
      deletionSubscriptions.set('repostRelayLoader', repostRelayLoaderSubscription);

      /** Load the calendar events referenced by share/repost events on-demand.
       * @param {any[]} shareEvents */
      function loadReferencedEvents(shareEvents) {
        // Extract unique event IDs and addressable references
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- ephemeral dedup, not reactive state
        const eventIds = new Set();
        /** @type {Array<{kind: number, pubkey: string, dTag: string}>} */
        const addressableRefs = [];

        shareEvents.forEach((shareEvent) => {
          const eTag = getTagValue(shareEvent, 'e');
          const aTag = getTagValue(shareEvent, 'a');

          if (eTag) {
            eventIds.add(eTag);
          }
          if (aTag) {
            const parsed = parseAddressReference(aTag);
            if (parsed) {
              addressableRefs.push(parsed);
            }
          }
        });

        // Start loader for events by ID
        if (eventIds.size > 0) {
          const timelineLoader = eventStore.timeline({
            ids: Array.from(eventIds)
          });
          // Handle both Observable and Promise returns
          if (timelineLoader && typeof timelineLoader.subscribe === 'function') {
            timelineLoader.subscribe();
          }
        }

        // Start loaders for addressable events
        addressableRefs.forEach((ref) => {
          addressLoader({
            kind: ref.kind,
            pubkey: ref.pubkey,
            identifier: ref.dTag
          }).subscribe();
        });
      }

      // 3. Watch targeted publications and load referenced calendar events on-demand
      const referencedEventsLoaderSubscription = eventStore
        .model(TimelineModel, {
          kinds: [30222],
          '#p': [communityPubkey],
          '#k': ['31922', '31923'],
          limit: 100
        })
        .subscribe(loadReferencedEvents);

      // Store this subscription so it can be cleaned up
      deletionSubscriptions.set('referencedEventsLoader', referencedEventsLoaderSubscription);

      // 3b. Same on-demand resolution for kind 6/16 repost references
      const repostReferencedSubscription = eventStore
        .model(TimelineModel, {
          kinds: [6, 16],
          '#h': [communityPubkey],
          limit: 100
        })
        .subscribe(loadReferencedEvents);
      deletionSubscriptions.set('repostReferencedLoader', repostReferencedSubscription);

      // 4. Use the CommunityCalendarEventModel to reactively combine all data
      subscription = eventStore.model(CommunityCalendarEventModel, communityPubkey).subscribe({
        next: (events) => {
          // Start deletion loaders for all unique authors (parallel pattern)
          // eslint-disable-next-line svelte/prefer-svelte-reactivity -- ephemeral dedup, not reactive state
          const authorPubkeys = [...new Set(events.map((e) => e.originalEvent.pubkey))];
          startDeletionLoaders(authorPubkeys);

          options.onEventsUpdate(events);
          options.onLoadingChange(false);
        },
        error: (err) => {
          console.error('📅 EventLoader: Error in community calendar model:', err);
          options.onError('Failed to load community calendar events');
          options.onLoadingChange(false);
        }
      });
    } catch (err) {
      console.error('📅 EventLoader: Error creating community subscriptions:', err);
      options.onError('Failed to connect to event stream');
      options.onLoadingChange(false);
    }
  }

  /**
   * Load events from specific relays
   * @param {string[]} relays - Relay URLs to use
   * @param {string[]} [authors] - Optional author pubkeys to filter by
   */
  function loadByRelays(relays, authors) {
    options.onLoadingChange(true);
    eventMap.clear();

    stopBackgroundLoader();
    relaySubscription = cleanupSubscription(relaySubscription);

    /** @type {{kinds: number[], limit: number, authors?: string[]}} */
    const filter = {
      kinds: [31922, 31923],
      limit: 50
    };

    if (authors && authors.length > 0) {
      filter.authors = authors;
    }

    relaySubscription = pool
      .subscription(relays, filter)
      .pipe(
        onlyEvents(),
        mapEventsToStore(eventStore),
        mapEventsToTimeline(),
        map((timeline) => [...timeline])
      )
      .subscribe({
        next: (timeline) => {
          // Start deletion loaders for all visible event authors (parallel pattern)
          // eslint-disable-next-line svelte/prefer-svelte-reactivity -- ephemeral dedup, not reactive state
          const authorPubkeys = [...new Set(timeline.map((e) => e.pubkey))];
          startDeletionLoaders(authorPubkeys);

          const mapped = timeline.map(getCalendarEventMetadata);
          options.onEventsUpdate(mapped);
          options.onLoadingChange(false);
        },
        error: (err) => {
          console.error('📅 EventLoader: Relay subscription error:', err);
          options.onError('Failed to load events from relays');
          options.onLoadingChange(false);
        }
      });
  }

  return {
    loadGlobal,
    loadByCalendar,
    loadByAuthor,
    loadByCommunity,
    loadByRelays,
    cleanup: cleanupAll
  };
}

/**
 * Helper function to sync URL filters to calendar filters store
 * @param {any} urlFilters - Parsed URL filters
 */
function syncFiltersToStore(urlFilters) {
  // Sync tags - normalize to lowercase for consistent filtering
  if (urlFilters?.tags && Array.isArray(urlFilters.tags)) {
    if (urlFilters.tags.length > 0) {
      const normalizedTags = urlFilters.tags.map((/** @type {string} */ tag) =>
        tag.toLowerCase().trim()
      );
      calendarFilters.setSelectedTags(normalizedTags);
    } else {
      calendarFilters.clearSelectedTags();
    }
  } else {
    calendarFilters.clearSelectedTags();
  }

  // Sync relays
  if (urlFilters?.relays && Array.isArray(urlFilters.relays)) {
    if (urlFilters.relays.length > 0) {
      calendarFilters.setSelectedRelays(urlFilters.relays);
    } else {
      calendarFilters.setSelectedRelays([]);
    }
  } else {
    calendarFilters.setSelectedRelays([]);
  }

  // Sync authors (follow lists)
  if (urlFilters?.authors && Array.isArray(urlFilters.authors)) {
    if (urlFilters.authors.length > 0) {
      calendarFilters.setSelectedFollowListIds(urlFilters.authors);
    } else {
      calendarFilters.setSelectedFollowListIds([]);
    }
  } else {
    calendarFilters.setSelectedFollowListIds([]);
  }

  // Sync search query
  if (urlFilters?.search && typeof urlFilters.search === 'string' && urlFilters.search.trim()) {
    calendarFilters.setSearchQuery(urlFilters.search);
  } else {
    calendarFilters.setSearchQuery('');
  }
}

/**
 * Creates a URL sync handler for use with afterNavigate
 * The component must call afterNavigate with the returned callback
 * @param {(mode: 'calendar' | 'list' | 'map') => void} onPresentationViewModeChange - Callback for presentation view mode changes
 * @param {(mode: 'month' | 'week' | 'day' | 'all') => void} onViewModeChange - Callback for view mode (period) changes
 * @returns {(navigation: any) => void} Handler function for afterNavigate
 */
export function createUrlSyncHandler(onPresentationViewModeChange, onViewModeChange) {
  return (navigation) => {
    // Guard against null navigation.to
    if (!navigation.to) {
      return;
    }

    // Parse filters from the new URL
    const urlFilters = /** @type {any} */ (parseCalendarFilters(navigation.to.url.searchParams));

    // Sync filters to store
    syncFiltersToStore(urlFilters);

    // Determine presentation view mode and period from URL
    const presentationView =
      urlFilters?.view && typeof urlFilters.view === 'string'
        ? /** @type {'calendar' | 'list' | 'map'} */ (urlFilters.view)
        : 'list';

    let period =
      urlFilters?.period && typeof urlFilters.period === 'string' ? urlFilters.period : 'month';

    // Validate period value - calendar view doesn't support 'all'
    if (presentationView === 'calendar' && period === 'all') {
      period = 'month';
    } else if (!['month', 'week', 'day', 'all'].includes(period)) {
      period = 'month';
    }

    // Apply the coordinated values to the component state
    onPresentationViewModeChange(presentationView);
    onViewModeChange(/** @type {'month' | 'week' | 'day' | 'all'} */ (period));
  };
}

/**
 * Syncs initial URL state on component mount
 * @param {URLSearchParams} searchParams - URL search params from $page.url.searchParams
 * @param {(mode: 'calendar' | 'list' | 'map') => void} onPresentationViewModeChange - Callback for presentation view mode changes
 * @param {(mode: 'month' | 'week' | 'day' | 'all') => void} onViewModeChange - Callback for view mode (period) changes
 */
export function syncInitialUrlState(searchParams, onPresentationViewModeChange, onViewModeChange) {
  const urlFilters = /** @type {any} */ (parseCalendarFilters(searchParams));

  // Sync filters to store
  syncFiltersToStore(urlFilters);

  // Determine presentation view mode and period from URL
  const presentationView =
    urlFilters?.view && typeof urlFilters.view === 'string'
      ? /** @type {'calendar' | 'list' | 'map'} */ (urlFilters.view)
      : 'list';

  let period =
    urlFilters?.period && typeof urlFilters.period === 'string' ? urlFilters.period : 'month';

  // Validate period value
  if (presentationView === 'calendar' && period === 'all') {
    period = 'month';
  } else if (!['month', 'week', 'day', 'all'].includes(period)) {
    period = 'month';
  }

  // Apply the coordinated values to the component state
  onPresentationViewModeChange(presentationView);
  onViewModeChange(/** @type {'month' | 'week' | 'day' | 'all'} */ (period));
}
