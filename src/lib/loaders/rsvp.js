/**
 * RSVP Loader
 * Loads RSVP events (kind 31925) for a specific calendar event
 */
import { EMPTY, from, merge } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { getSeenRelays, normalizeURL } from 'applesauce-core/helpers';
import { fetchEvents } from '$lib/loaders/base.js';
import { getCalendarRelays } from '$lib/helpers/relay-helper.js';
import { getReadRelays } from '$lib/services/relay-service.svelte.js';

// The author's NIP-65 relay list (kind 10002) is self-published and can name
// arbitrarily many relays; cap how many of the author's read/inbox relays
// this loader adds on top of the calendar relays so a bloated list can't make
// it open an unbounded number of relay connections. This is a connection-
// count bound, not a host check: browser WebSockets are not an SSRF vector
// the way server-side HTTP fetches are (see the `isPrivateIp`/DNS guard in
// `src/lib/server/httpUrl.js`, which only applies to those), and there is no
// client-side equivalent of that guard to apply to relay URLs here.
const MAX_EXTRA_RSVP_RELAYS = 8;

/** @param {string} url */
function normalize(url) {
  try {
    return normalizeURL(url);
  } catch {
    return url;
  }
}

/**
 * Relays beyond the calendar relays worth asking for a calendar event's
 * RSVPs: the relays the event itself was seen on (an attendee may only
 * publish their RSVP back to the relay they found the event through) and the
 * event author's NIP-65 read/inbox relays (where others are expected to send
 * events addressed to the author — the same relay-service helper the
 * reactions loader uses, for the same reason; see `getReadRelays` doc).
 * Deduplicated against the calendar relays already queried and capped.
 *
 * @param {any} calendarEvent
 * @param {Set<string>} askedRelays - normalized relays already queried (calendar relays)
 * @returns {Promise<string[]>}
 */
async function getExtraRsvpRelays(calendarEvent, askedRelays) {
  /** @type {Set<string>} */
  const extras = new Set();

  const seenRelays = getSeenRelays(calendarEvent);
  if (seenRelays) {
    for (const relay of seenRelays) {
      const normalized = normalize(relay);
      if (!askedRelays.has(normalized)) extras.add(normalized);
    }
  }

  if (calendarEvent?.pubkey) {
    const authorRelays = await getReadRelays(calendarEvent.pubkey);
    for (const relay of authorRelays) {
      const normalized = normalize(relay);
      if (!askedRelays.has(normalized)) extras.add(normalized);
    }
  }

  return Array.from(extras).slice(0, MAX_EXTRA_RSVP_RELAYS);
}

/**
 * Load all RSVP events (kind 31925) that reference a specific calendar event.
 * One-shot: cache + calendar relays, plus the event's seen relays and the
 * author's NIP-65 inbox relays, into the EventStore. An RSVP published only
 * to the relay an attendee found the event on, or only to the author's
 * inbox, would otherwise never be found when it never reached the calendar
 * relays.
 *
 * @param {any} calendarEvent - The calendar event object
 * @returns {import('rxjs').Observable<any>}
 */
export const calendarEventRsvpLoader = (calendarEvent) => {
  // Extract event coordinates for the 'a' tag
  const dTag = calendarEvent.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
  const eventCoordinate = `${calendarEvent.kind}:${calendarEvent.pubkey}:${dTag}`;

  /** @type {import('nostr-tools').Filter} */
  const filter = {
    kinds: [31925], // NIP-52 Calendar Event RSVP kind
    '#a': [eventCoordinate], // Filter by calendar event coordinate
    limit: 200 // Allow for many attendees
  };

  const calendarRelays = getCalendarRelays();
  const base$ = fetchEvents(calendarRelays, filter, { cache: true });

  const askedRelays = new Set(calendarRelays.map(normalize));
  const extra$ = from(getExtraRsvpRelays(calendarEvent, askedRelays)).pipe(
    switchMap((extraRelays) => (extraRelays.length > 0 ? fetchEvents(extraRelays, filter) : EMPTY)),
    catchError(() => EMPTY)
  );

  return merge(base$, extra$);
};
