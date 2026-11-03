import { nip19 } from 'nostr-tools';
import { getIcsEventTiming, dedupeReplaceableEvents } from '$lib/helpers/calendar-timing.js';
import { foldIcsLine, sanitizeIcsUid } from '$lib/helpers/ics-text.js';

/**
 * Pure ICS-building helpers for the calendar export endpoint
 * (`src/routes/api/calendar/[id]/ics/+server.js`). Split out into their own
 * module so they can be unit-tested directly: a SvelteKit `+server.js` may
 * only export the HTTP verb handlers and a small fixed set of route-config
 * keys (`@sveltejs/kit`'s `validate_server_exports`), so a plain helper
 * export there throws `Invalid export '…' in +server.js` at build time.
 */

/**
 * Pure tag accessor — first value of a single-occurrence tag.
 * @param {import('nostr-tools').NostrEvent} event
 * @param {string} name
 * @returns {string | undefined}
 */
export function tagValue(event, name) {
  const t = event.tags.find((tag) => tag[0] === name);
  return t ? t[1] : undefined;
}

/**
 * Encode a parameterized replaceable event as an naddr for ICS URL building.
 * @param {import('nostr-tools').NostrEvent} event
 * @returns {string}
 */
export function eventToNaddr(event) {
  return nip19.naddrEncode({
    kind: event.kind,
    pubkey: event.pubkey,
    identifier: tagValue(event, 'd') || ''
  });
}

/**
 * The NIP-52 replaceable-event coordinate (`kind:pubkey:d`), sanitised for
 * use as an ICS UID. Stable across every revision of an addressable event —
 * unlike the event id, which changes on every edit — so a subscribed
 * calendar client updates its existing entry (matched by UID + a growing
 * SEQUENCE) instead of seeing each edit as a delete-plus-new.
 *
 * @param {import('nostr-tools').NostrEvent} event
 * @returns {string}
 */
function eventIcsUid(event) {
  const dTag = tagValue(event, 'd') || '';
  return `${sanitizeIcsUid(`${event.kind}:${event.pubkey}:${dTag}`)}@edufeed.com`;
}

/**
 * Build the ICS body. Pure — operates on plain Nostr events.
 *
 * @param {{title: string, summary: string}} calendarMetadata
 * @param {import('nostr-tools').NostrEvent[]} events
 * @param {URL} url
 * @returns {string}
 */
export function generateICSContent(calendarMetadata, events, url) {
  const now = new Date();

  /**
   * @param {string|number|undefined|null} timestamp
   * @returns {string}
   */
  const formatDateTime = (timestamp) => {
    if (timestamp === undefined || timestamp === null || isNaN(Number(timestamp))) return '';
    const num = typeof timestamp === 'string' ? parseInt(timestamp) : timestamp;
    if (!isFinite(num)) return '';
    const date = new Date(num * 1000);
    if (isNaN(date.getTime())) return '';
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };

  /**
   * @param {string|number|undefined|null} timestamp
   * @returns {string}
   */
  const formatDateOnly = (timestamp) => {
    if (timestamp === undefined || timestamp === null || isNaN(Number(timestamp))) return '';
    const num = typeof timestamp === 'string' ? parseInt(timestamp) : timestamp;
    if (!isFinite(num)) return '';
    const date = new Date(num * 1000);
    if (isNaN(date.getTime())) return '';
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  };

  /**
   * @param {string} text
   * @returns {string}
   */
  const escapeText = (text) =>
    text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

  /** @type {string[]} */
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Edufeed//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarMetadata.title || 'Edufeed Calendar')}`,
    `X-WR-CALDESC:${escapeText(calendarMetadata.summary || '')}`,
    'X-WR-TIMEZONE:UTC',
    `LAST-MODIFIED:${formatDateTime(now.getTime() / 1000)}`
  ];

  for (const event of dedupeReplaceableEvents(events)) {
    const timing = getIcsEventTiming(event);
    if (!timing) continue;

    let dtStartProperty;
    let dtEndProperty;
    if (timing.isAllDay) {
      dtStartProperty = `DTSTART;VALUE=DATE:${formatDateOnly(timing.start)}`;
      dtEndProperty = `DTEND;VALUE=DATE:${formatDateOnly(timing.end)}`;
    } else {
      dtStartProperty = `DTSTART:${formatDateTime(timing.start)}`;
      // No end tag on a time-based (31923) event: NIP-52 says it "ends
      // instantaneously" (unlike 31922, where a missing `end` means "ends on
      // the same date as `start`") — omit DTEND rather than fabricating a
      // duration.
      dtEndProperty = timing.end ? `DTEND:${formatDateTime(timing.end)}` : '';
    }

    const eventNaddr = eventToNaddr(event);
    const baseUrl = url.origin;
    const title = tagValue(event, 'title') || 'Untitled Event';
    // NIP-52: "The `.content` of these events SHOULD be a description of
    // the calendar event", while `summary` is only an optional "brief
    // description" — prefer `content` and fall back to `summary` for
    // events that only set the latter.
    const description = event.content || tagValue(event, 'summary') || '';
    const location = tagValue(event, 'location');

    ics.push(
      'BEGIN:VEVENT',
      `UID:${eventIcsUid(event)}`,
      dtStartProperty,
      dtEndProperty,
      `SUMMARY:${escapeText(title)}`,
      `DESCRIPTION:${escapeText(description)}`,
      location ? `LOCATION:${escapeText(location)}` : '',
      `URL:${baseUrl}/calendar/event/${eventNaddr}`,
      `CREATED:${formatDateTime(event.created_at)}`,
      // `created_at` grows on every revision of an addressable event, so it
      // doubles as a monotonic SEQUENCE: a calendar client only replaces an
      // entry it already holds when the UID matches and SEQUENCE grew
      // (RFC 5545 §3.8.7.4).
      `SEQUENCE:${event.created_at}`,
      `LAST-MODIFIED:${formatDateTime(event.created_at)}`,
      'END:VEVENT'
    );
  }

  ics.push('END:VCALENDAR');
  return ics
    .filter((line) => line !== '')
    .map(foldIcsLine)
    .join('\r\n');
}
