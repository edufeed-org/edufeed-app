/**
 * Personal Calendar Events Model
 * Recreates applesauce's CalendarEventsModel with extensive logging for debugging
 *
 * This model parses a calendar's 'a' tags and uses replaceable() queries
 * to fetch each referenced calendar event from the EventStore.
 *
 * @param {any} calendar - The calendar event (kind 31924) containing 'a' tag references
 * @returns {import('applesauce-core').Model<Array<import('$lib/types/calendar.js').CalendarEvent>>}
 */
import { combineLatest, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { getCalendarEventMetadata } from '$lib/helpers/eventUtils';
import { parseAddressPointerFromATag } from '$lib/helpers/nostrUtils.js';

/**
 * Helper to parse address pointers from calendar 'a' tags
 * Using parseAddressPointerFromATag to correctly handle d-tags with colons (like URLs)
 * @param {any} calendar
 * @returns {Array<{kind: number, pubkey: string, identifier: string}>}
 */
function getCalendarAddressPointers(calendar) {
  const pointers = calendar.tags
    .filter((/** @type {any[]} */ tag) => tag[0] === 'a')
    .map((/** @type {any[]} */ tag) => parseAddressPointerFromATag(tag))
    .filter((/** @type {any} */ pointer) => pointer !== null);

  return pointers;
}

export function PersonalCalendarEventsModel(/** @type {any} */ calendar) {
  return (/** @type {any} */ eventStore) => {
    const pointers = getCalendarAddressPointers(calendar);

    if (pointers.length === 0) {
      return of([]);
    }

    // Create a replaceable query for each pointer
    // IMPORTANT: Do NOT filter out null/undefined here, as combineLatest requires all observables to emit
    const queries = pointers.map((pointer) =>
      eventStore.replaceable(pointer.kind, pointer.pubkey, pointer.identifier)
    );

    // If no queries, return empty array
    if (queries.length === 0) {
      return of([]);
    }

    // Combine all queries (using array syntax to avoid deprecation warning)
    return combineLatest(queries).pipe(
      map((events) => {
        // Filter out null/undefined events
        const validEvents = events.filter((event) => event != null);

        // Transform to calendar event format
        const calendarEvents = validEvents.map((event) => getCalendarEventMetadata(event));

        return calendarEvents;
      })
    );
  };
}
