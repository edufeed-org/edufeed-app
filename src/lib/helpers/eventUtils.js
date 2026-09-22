import { getCalendarTitle, getCalendarEventImage } from 'applesauce-common/helpers';
import { parseCalendarTimestamp, dedupeCalendarTwins } from '$lib/helpers/calendar.js';
import { validateCalendarEvent } from '$lib/helpers/eventValidation.js';
import { uniqueBy } from '$lib/helpers/unique.js';

/**
 * @typedef {import('$lib/types/calendar.js').CalendarEvent} CalendarEvent
 */

/**
 * Validate, transform, and sort raw calendar events.
 * Shared pipeline for calendar models.
 * @param {any[]} rawEvents
 * @returns {CalendarEvent[]}
 */
export function validateAndTransformCalendarEvents(rawEvents) {
  // The EventStore replaces per kind:pubkey:d, so an appointment republished
  // under the other NIP-52 kind keeps BOTH addresses alive and reaches every
  // calendar view twice. Collapse those twins before validating.
  return dedupeCalendarTwins(rawEvents)
    .filter((event) => validateCalendarEvent(event))
    .map((event) => getCalendarEventMetadata(event))
    .sort((a, b) => (a.start || 0) - (b.start || 0));
}

/**
 * Convert raw event to CalendarEvent format
 * @param {any} event
 * @returns {CalendarEvent}
 */
export function getCalendarEventMetadata(event) {
  const tagMap = new Map();
  event.tags.forEach((/** @type {any[]} */ tag) => {
    const [key, ...values] = tag;
    if (!tagMap.has(key)) {
      tagMap.set(key, []);
    }
    tagMap.get(key).push(...values);
  });

  const getTagValue = (/** @type {string} */ tagName) => tagMap.get(tagName)?.[0];
  const getTagValues = (/** @type {string} */ tagName) => tagMap.get(tagName) || [];

  // Parse time values per NIP-52: date strings for kind 31922, Unix timestamps for kind 31923
  const startValue = getTagValue('start');
  const endValue = getTagValue('end');

  const start = parseCalendarTimestamp(startValue, event.kind);
  const end = parseCalendarTimestamp(endValue, event.kind);

  // Parse participants from p tags according to NIP-52
  // Format: ["p", "<pubkey>", "<optional relay>", "<optional role>"]
  /** @type {import('$lib/types/calendar.js').CalendarEventParticipant[]} */
  const participants = event.tags
    .filter((/** @type {any[]} */ tag) => tag[0] === 'p')
    .map((/** @type {any[]} */ tag) => ({
      pubkey: tag[1],
      relay: tag[2] || undefined,
      role: tag[3] || undefined
    }))
    .filter((/** @type {any} */ p) => p.pubkey); // Only include if pubkey exists

  // Named participants without an npub (app-specific, mirrors the p-tag slots):
  // ["participant", "<name>", "", "<optional role>"]
  for (const tag of event.tags) {
    if (tag[0] !== 'participant') continue;
    const name = typeof tag[1] === 'string' ? tag[1].trim() : '';
    if (!name) continue;
    participants.push({ name, role: tag[3] || undefined });
  }
  // Tags are untrusted input: a repeated p/participant tag would collide in
  // the keyed {#each} of the detail views (each_key_duplicate crashes the page).
  const dedupedParticipants = uniqueBy(participants, (p) => p.pubkey ?? `name:${p.name}`);

  return {
    id: event.id,
    pubkey: event.pubkey,
    kind: /** @type {import('$lib/types/calendar.js').CalendarEventKind} */ (event.kind),
    title: getCalendarTitle(event) || 'Untitled Event',
    summary: event.content || getTagValue('summary') || getTagValue('description'),
    image: getCalendarEventImage(event) || '',
    startTimezone: getTagValue('start_tzid'),
    endTimezone: getTagValue('end_tzid'),
    start,
    end,
    location: getTagValue('location'),
    participants: dedupedParticipants,
    hashtags: getTagValues('t'),
    references: getTagValues('r'),
    eventReferences: getTagValues('a'),
    geohash: getTagValue('g'),
    communityPubkey: '',
    createdAt: event.created_at,
    dTag: getTagValue('d'),
    originalEvent: event
  };
}

/**
 * Parse address reference string into components
 * @param {string} addressRef - Address reference like "31922:pubkey:d-tag"
 * @returns {{kind: number, pubkey: string, dTag: string} | null}
 */
export function parseAddressReference(addressRef) {
  try {
    const parts = addressRef.split(':');
    if (parts.length !== 3) return null;

    const [kindStr, pubkey, dTag] = parts;
    const kind = parseInt(kindStr, 10);

    if (isNaN(kind) || !pubkey || !dTag) return null;

    return { kind, pubkey, dTag };
  } catch (error) {
    console.error('📅 SimpleCalendarView: Error parsing address reference:', addressRef, error);
    return null;
  }
}
