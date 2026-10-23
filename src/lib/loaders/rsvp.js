/**
 * RSVP Loader
 * Loads RSVP events (kind 31925) for a specific calendar event
 */
import { fetchEvents } from '$lib/loaders/base.js';
import { getCalendarRelays } from '$lib/helpers/relay-helper.js';

/**
 * Load all RSVP events (kind 31925) that reference a specific calendar event.
 * One-shot: cache + calendar relays into the EventStore.
 *
 * @param {any} calendarEvent - The calendar event object
 * @returns {import('rxjs').Observable<any>}
 */
export const calendarEventRsvpLoader = (calendarEvent) => {
  // Extract event coordinates for the 'a' tag
  const dTag = calendarEvent.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
  const eventCoordinate = `${calendarEvent.kind}:${calendarEvent.pubkey}:${dTag}`;

  return fetchEvents(
    getCalendarRelays(),
    {
      kinds: [31925], // NIP-52 Calendar Event RSVP kind
      '#a': [eventCoordinate], // Filter by calendar event coordinate
      limit: 200 // Allow for many attendees
    },
    { cache: true }
  );
};
