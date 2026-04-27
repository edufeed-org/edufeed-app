/**
 * RSVP Loader
 * Loads RSVP events (kind 31925) for a specific calendar event
 */
import { createCachedTimelineLoader } from '$lib/loaders/base.js';
import { getCalendarRelays } from '$lib/helpers/relay-helper.js';

/**
 * Factory: Create a timeline loader for calendar event RSVPs
 * Loads all RSVP events (kind 31925) that reference a specific calendar event
 *
 * @param {any} calendarEvent - The calendar event object
 * @returns {Function} Timeline loader function that returns an Observable
 *
 * @example
 * // Load RSVPs for a calendar event
 * const rsvpLoader = calendarEventRsvpLoader(event);
 * rsvpLoader().subscribe(rsvpEvents => {
 *   // Process RSVP events
 *   console.log('RSVP events:', rsvpEvents);
 * });
 */
export const calendarEventRsvpLoader = (calendarEvent) => {
  // Extract event coordinates for the 'a' tag
  const dTag = calendarEvent.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
  const eventCoordinate = `${calendarEvent.kind}:${calendarEvent.pubkey}:${dTag}`;

  return createCachedTimelineLoader(getCalendarRelays(), {
    kinds: [31925], // NIP-52 Calendar Event RSVP kind
    '#a': [eventCoordinate], // Filter by calendar event coordinate
    limit: 200 // Allow for many attendees
  });
};
