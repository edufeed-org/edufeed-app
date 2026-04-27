/**
 * Calendar domain loaders for NIP-52 calendar events.
 * Includes timeline loaders and factory functions for custom filtering.
 */
import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { from, merge, EMPTY } from 'rxjs';
import { mergeMap, filter, tap, switchMap } from 'rxjs/operators';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader, timedPool } from './base.js';
import { getCalendarRelays } from '$lib/helpers/relay-helper.js';
import { parseAddressPointerFromATag } from '$lib/helpers/nostrUtils.js';
import {
  isEventStartAfter,
  getEventStartTimestamp,
  getEventEndTimestamp
} from '$lib/helpers/calendar.js';
import {
  partitionRelaysByNip52Support,
  preWarmRelayCapabilitiesCache
} from '$lib/services/relay-capabilities.js';
import {
  getCuratedAuthors,
  applyCuratedFilter
} from '$lib/services/curated-authors-service.svelte.js';

let _prefetched = false;

/**
 * Prefetch calendar data into EventStore. Safe to call multiple times — only runs once.
 * Warms relay NIP-52 capabilities cache and starts background timeline loader.
 */
export function prefetchCalendarData() {
  if (_prefetched) return;
  const relays = getCalendarRelays();
  if (relays.length === 0) return;
  _prefetched = true;
  preWarmRelayCapabilitiesCache(relays);
  calendarTimelineLoader()().subscribe();
}

// Global calendar events (kinds 31922, 31923)
// Lazy factory to ensure relays are read from runtime config at call time, not module load time
export const calendarTimelineLoader = () => {
  const filter = applyCuratedFilter({ kinds: [31922, 31923], limit: 40 });
  return createTimelineLoader(timedPool, getCalendarRelays(), filter, { eventStore });
};

/**
 * Create a timeline loader for calendar events with custom relay filtering.
 * Note: Relay resolution is deferred to loader execution time to ensure
 * user override relays (kind 30002) are included even if they load asynchronously.
 * @param {string[]} customRelays - Array of relay URLs to query. If empty, uses default relays.
 * @param {{authors?: string[], [key: string]: any}} additionalFilters - Additional filter parameters (e.g., authors, limit)
 * @returns {Function} Timeline loader function that returns an Observable
 */
export const createRelayFilteredCalendarLoader = (customRelays = [], additionalFilters = {}) => {
  return () => {
    // Resolve relays at execution time, not creation time
    const relaysToUse = customRelays.length > 0 ? customRelays : getCalendarRelays();

    // Apply curated authors unless caller already specified authors
    // Note: [] is truthy, so check .length to avoid bypassing curated authors when UI filter is empty
    const authors =
      additionalFilters.authors && additionalFilters.authors.length > 0
        ? additionalFilters.authors
        : getCuratedAuthors('calendar');
    /** @type {import('nostr-tools').Filter} */
    const filter = { kinds: [31922, 31923], limit: 200, ...additionalFilters };
    if (authors) filter.authors = authors;

    return createTimelineLoader(timedPool, relaysToUse, filter, { eventStore })();
  };
};

/**
 * @typedef {Object} DateRangeFilters
 * @property {number} rangeStart - Visible window start (Unix seconds)
 * @property {number} rangeEnd - Visible window end (Unix seconds)
 */

/**
 * Create a date-range aware calendar loader with full NIP-52 filter support.
 * Fetches every event that *overlaps* the window — events starting before it and
 * ending inside it are included, fixing the multi-day blind spot of a start-only query.
 *
 * Intelligently routes queries based on relay NIP-52 support:
 * - NIP-52 relays: server-side overlap via `#start_before` + `#end_after`
 *   (NIP-01 ANDs across keys, so this matches event.start < rangeEnd AND event.end > rangeStart)
 * - Standard relays: standard query + client-side overlap filtering
 *
 * @param {DateRangeFilters} dateRange - {rangeStart, rangeEnd}
 * @param {Object} [options] - Additional options
 * @param {string[]} [options.authors] - Filter by specific authors
 * @param {string[]} [options.relays] - Relay URLs to query. Empty/missing falls back to getCalendarRelays().
 * @returns {Function} Loader function that returns an Observable
 */
export function createDateRangeCalendarLoader(dateRange, options = {}) {
  const { rangeStart, rangeEnd } = dateRange;
  // Note: [] is truthy, so check .length to avoid bypassing curated authors when UI filter is empty
  const effectiveAuthors =
    options.authors && options.authors.length > 0 ? options.authors : getCuratedAuthors('calendar');

  return () => {
    // Resolve relays at execution time so user override relays (kind 30002) are included
    // even if they loaded asynchronously after the loader was created.
    const allRelays =
      options.relays && options.relays.length > 0 ? options.relays : getCalendarRelays();

    // Build base filter
    /** @type {any} */
    const baseFilter = {
      kinds: [31922, 31923]
    };
    if (effectiveAuthors && effectiveAuthors.length > 0) {
      baseFilter.authors = effectiveAuthors;
    }

    // Partition relays by actual NIP-52 support, then query appropriately
    return from(partitionRelaysByNip52Support(allRelays)).pipe(
      switchMap(({ nip52Relays, standardRelays }) => {
        /** @type {import('rxjs').Observable<import('nostr-tools').NostrEvent>[]} */
        const streams = [];

        // NIP-52 relays: server-side overlap filter
        // Events without an `end` tag are treated as point-in-time (end == start);
        // khatru's calendar index indexes these under both start and end, so `#end_after`
        // still matches them.
        if (nip52Relays.length > 0) {
          /** @type {any} */
          const nip52Filter = {
            ...baseFilter,
            '#start_before': [String(rangeEnd)],
            '#end_after': [String(rangeStart)]
          };

          streams.push(timedPool(nip52Relays, nip52Filter).pipe(tap((e) => eventStore.add(e))));
        }

        // Standard relays: client-side overlap filtering
        // These relays don't understand NIP-52 date filters, so we over-fetch and filter client-side
        if (standardRelays.length > 0) {
          const standardFilter = {
            ...baseFilter,
            limit: 500 // Over-fetch since we filter client-side
          };

          streams.push(
            timedPool(standardRelays, standardFilter).pipe(
              filter((event) => {
                const eventStart = getEventStartTimestamp(event);
                const eventEnd = getEventEndTimestamp(event) || eventStart;
                // Overlap: event.start <= rangeEnd AND event.end >= rangeStart
                return eventStart <= rangeEnd && eventEnd >= rangeStart;
              }),
              tap((e) => eventStore.add(e))
            )
          );
        }

        // Merge all streams - EventStore handles deduplication by event ID
        return streams.length > 0 ? merge(...streams) : EMPTY;
      })
    );
  };
}

/**
 * Create a paginated calendar loader that loads events by start time.
 * Intelligently routes queries based on relay NIP-52 support:
 * - NIP-52 relays: Use #start_after filter for server-side filtering
 * - Standard relays: Use higher limit + client-side filtering by start tag
 *
 * Uses timedPool wrapper which adds a timeout to pool.request().
 *
 * @param {number} afterStartTimestamp - Load events with start > this timestamp (Unix seconds)
 * @param {Object} [options] - Additional options
 * @param {number} [options.limit=20] - Max events to return per relay type
 * @returns {Function} Loader function that returns an Observable
 */
export function createPaginatedCalendarLoader(afterStartTimestamp, options = {}) {
  const { limit = 20 } = options;

  return () => {
    const allRelays = getCalendarRelays();

    // First partition relays by NIP-52 support, then query
    return from(partitionRelaysByNip52Support(allRelays)).pipe(
      switchMap(({ nip52Relays, standardRelays }) => {
        /** @type {import('rxjs').Observable<import('nostr-tools').NostrEvent>[]} */
        const streams = [];

        const curatedAuthorsList = getCuratedAuthors('calendar');

        // NIP-52 relays: server-side start filtering via #start_after
        if (nip52Relays.length > 0) {
          /** @type {any} */
          const nip52Filter = {
            kinds: [31922, 31923],
            '#start_after': [String(afterStartTimestamp)],
            limit
          };
          if (curatedAuthorsList) nip52Filter.authors = curatedAuthorsList;
          streams.push(timedPool(nip52Relays, nip52Filter).pipe(tap((e) => eventStore.add(e))));
        }

        // Standard relays: client-side start filtering
        // These relays don't understand #start_after, so we over-fetch and filter client-side
        if (standardRelays.length > 0) {
          /** @type {any} */
          const standardFilter = {
            kinds: [31922, 31923],
            limit: limit * 3 // Over-fetch since we filter client-side
          };
          if (curatedAuthorsList) standardFilter.authors = curatedAuthorsList;
          streams.push(
            timedPool(standardRelays, standardFilter).pipe(
              filter((event) => isEventStartAfter(event, afterStartTimestamp)),
              tap((e) => eventStore.add(e))
            )
          );
        }

        return streams.length > 0 ? merge(...streams) : EMPTY;
      })
    );
  };
}

// Calendar definition loader for personal calendars (kind 31924)
// NOTE: This loads ALL calendars without filtering - use userCalendarLoader for user-specific calendars
// Lazy factory to ensure relays are read from runtime config at call time, not module load time
export const calendarLoader = () =>
  createTimelineLoader(
    timedPool,
    getCalendarRelays(),
    {
      kinds: [31924], // Calendar definitions
      limit: 100
    },
    { eventStore }
  );

/**
 * Factory: Create a timeline loader for user-specific calendar definitions
 * This loader filters calendars by author at the relay level for efficiency
 * @param {string} userPubkey - The pubkey of the user whose calendars to load
 * @returns {Function} Timeline loader function that returns an Observable
 */
export const userCalendarLoader = (userPubkey) =>
  createTimelineLoader(
    timedPool,
    getCalendarRelays(),
    {
      kinds: [31924], // Calendar definitions
      authors: [userPubkey], // Filter by user at relay level
      limit: 100
    },
    { eventStore }
  );

/**
 * Factory: Create a timeline loader for community-specific calendar events
 * @param {string} communityPubkey - The pubkey of the community
 * @returns {Function} Timeline loader function that returns an Observable
 */
export const communityCalendarTimelineLoader = (communityPubkey) => {
  const filter = applyCuratedFilter({
    kinds: [31922, 31923],
    '#h': [communityPubkey],
    limit: 250
  });
  return createTimelineLoader(timedPool, getCalendarRelays(), filter, { eventStore });
};

/**
 * Factory: Create a loader for events referenced by a calendar
 * Uses addressLoader to fetch specific addressable events by their coordinates
 * @param {any} calendar - The raw calendar Event object (kind 31924)
 * @returns {Function} Loader function that returns an Observable
 */
export const calendarEventReferencesLoader = (calendar) => {
  // Parse 'a' tag coordinates into LoadableAddressPointer objects
  // Format: "kind:pubkey:d-tag" -> { kind, pubkey, identifier }
  // Using local parseAddressPointerFromATag to correctly handle d-tags with colons (like URLs)
  const pointers = calendar.tags
    .filter((/** @type {any[]} */ tag) => tag[0] === 'a')
    .map((/** @type {any[]} */ tag) => {
      const pointer = parseAddressPointerFromATag(tag);
      console.log(
        '📅 calendarEventReferencesLoader: Parsed pointer from a-tag',
        tag,
        '->',
        pointer
      );
      return pointer;
    })
    .filter((/** @type {any} */ pointer) => pointer !== null); // Filter out invalid pointers

  console.log(
    '📅 calendarEventReferencesLoader: Found',
    pointers.length,
    'event pointers:',
    pointers
  );

  if (pointers.length === 0) {
    console.warn('📅 calendarEventReferencesLoader: No event coordinates found in calendar');
  }

  // Iterate over pointers and call addressLoader for each one
  // addressLoader has built-in batching, so these will be efficiently batched
  return () =>
    from(pointers).pipe(
      mergeMap((/** @type {any} */ pointer) => {
        console.log('📅 Loading event from pointer:', pointer);
        return addressLoader(pointer);
      })
    );
};
