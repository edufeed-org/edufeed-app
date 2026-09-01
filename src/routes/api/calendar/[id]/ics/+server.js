import { nip19 } from 'nostr-tools';
import {
  getCalendarRelaysServer,
  decodeIdentifier,
  fetchEventFromRelays,
  fetchEventsFromRelays
} from '$lib/server/nostr-fetch.js';
import { getIcsEventTiming, dedupeReplaceableEvents } from '$lib/helpers/calendar-timing.js';

/**
 * Server-side ICS feed for both NIP-52 calendars (`naddr`) and community
 * calendars (hex pubkey / npub). Fetches events from relays directly via
 * `$lib/server/nostr-fetch.js` so this endpoint does not depend on the
 * browser-only EventStore + runtimeConfig stack.
 */

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i;

/**
 * Detect identifier type without pulling in client-only helpers.
 * @param {string} identifier
 * @returns {'naddr' | 'pubkey' | 'unknown'}
 */
function detectIdentifierType(identifier) {
  if (!identifier || typeof identifier !== 'string') return 'unknown';
  if (identifier.startsWith('naddr1')) return 'naddr';
  if (identifier.startsWith('npub1') || HEX_PUBKEY_RE.test(identifier)) return 'pubkey';
  return 'unknown';
}

/**
 * Pure tag accessor — first value of a single-occurrence tag.
 * @param {import('nostr-tools').NostrEvent} event
 * @param {string} name
 * @returns {string | undefined}
 */
function tagValue(event, name) {
  const t = event.tags.find((tag) => tag[0] === name);
  return t ? t[1] : undefined;
}

/**
 * Encode a parameterized replaceable event as an naddr for ICS URL building.
 * @param {import('nostr-tools').NostrEvent} event
 * @returns {string}
 */
function eventToNaddr(event) {
  return nip19.naddrEncode({
    kind: event.kind,
    pubkey: event.pubkey,
    identifier: tagValue(event, 'd') || ''
  });
}

/**
 * Safely encode filename for Content-Disposition header (RFC 5987).
 * @param {string} filename
 * @returns {string}
 */
function encodeFilename(filename) {
  const name = filename.replace(/\.ics$/, '');
  const asciiFallback = name.replace(/[^\x20-\x7E]/g, '').trim() || 'calendar';
  const encoded = encodeURIComponent(name).replace(/['()]/g, escape);
  return `attachment; filename="${asciiFallback}.ics"; filename*=UTF-8''${encoded}.ics`;
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ url, params }) {
  const calendarIdentifier = params?.id;

  if (!calendarIdentifier) {
    return jsonError('Calendar ID is required', 400);
  }

  const identifierType = detectIdentifierType(calendarIdentifier);

  if (identifierType === 'naddr') {
    return handleNaddrCalendar(calendarIdentifier, url);
  }
  if (identifierType === 'pubkey') {
    return handleCommunityCalendar(calendarIdentifier, url);
  }
  return jsonError('Invalid calendar identifier format', 400);
}

/**
 * Handle a NIP-52 (kind 31924) calendar referenced by naddr.
 * @param {string} naddr
 * @param {URL} url
 * @returns {Promise<Response>}
 */
async function handleNaddrCalendar(naddr, url) {
  const decoded = decodeIdentifier(naddr);
  if (!decoded || decoded.type !== 'naddr' || decoded.kind !== 31924) {
    return jsonError('Invalid calendar naddr', 400);
  }

  const relays = getCalendarRelaysServer(decoded.relays);

  const calendar = await fetchEventFromRelays(
    {
      kinds: [31924],
      authors: [decoded.pubkey],
      '#d': [decoded.identifier],
      limit: 1
    },
    relays
  );

  if (!calendar) {
    return jsonError('Calendar not found', 404);
  }

  // Resolve referenced events from `a` tags. Each entry is `kind:pubkey:dtag`
  // optionally followed by a relay hint.
  const aTags = calendar.tags.filter((t) => t[0] === 'a');
  const referenced = await Promise.all(
    aTags.map(async (tag) => {
      const value = tag[1];
      const hint = tag[2];
      if (!value) return null;
      const parts = value.split(':');
      if (parts.length < 3) return null;
      const [kindStr, pubkey, ...dParts] = parts;
      const dTag = dParts.join(':');
      const kind = Number.parseInt(kindStr, 10);
      if (!Number.isFinite(kind) || (kind !== 31922 && kind !== 31923)) return null;

      const eventRelays = getCalendarRelaysServer(hint ? [hint] : []);
      return fetchEventFromRelays(
        {
          kinds: [kind],
          authors: [pubkey],
          '#d': [dTag],
          limit: 1
        },
        eventRelays
      );
    })
  );

  const events = /** @type {import('nostr-tools').NostrEvent[]} */ (referenced.filter(Boolean));

  const ics = generateICSContent(
    {
      title: tagValue(calendar, 'title') || '',
      summary: tagValue(calendar, 'summary') || ''
    },
    events,
    url
  );

  return icsResponse(ics, tagValue(calendar, 'title') || 'edufeed-calendar');
}

/**
 * Handle a community calendar referenced by hex pubkey or npub.
 * @param {string} pubkeyOrNpub
 * @param {URL} url
 * @returns {Promise<Response>}
 */
async function handleCommunityCalendar(pubkeyOrNpub, url) {
  let communityPubkey = pubkeyOrNpub;
  if (pubkeyOrNpub.startsWith('npub1')) {
    try {
      const decoded = nip19.decode(pubkeyOrNpub);
      if (decoded.type === 'npub') {
        communityPubkey = /** @type {string} */ (decoded.data);
      } else {
        return jsonError('Invalid npub format', 400);
      }
    } catch {
      return jsonError('Invalid npub format', 400);
    }
  }

  const baseRelays = getCalendarRelaysServer();

  // Profile (kind 0) and community def (kind 10222) in parallel.
  const [profileEvent, communityDefEvent] = await Promise.all([
    fetchEventFromRelays({ kinds: [0], authors: [communityPubkey], limit: 1 }, baseRelays),
    fetchEventFromRelays({ kinds: [10222], authors: [communityPubkey], limit: 1 }, baseRelays)
  ]);

  let title = 'Community Calendar';
  let summary = '';
  if (profileEvent) {
    try {
      const meta = JSON.parse(profileEvent.content || '{}');
      const displayName = meta.name || meta.display_name || '';
      if (displayName) title = `${displayName} Calendar`;
      if (meta.about) summary = meta.about;
    } catch {
      // ignore malformed profile JSON
    }
  }
  if (communityDefEvent) {
    const descriptionTag = tagValue(communityDefEvent, 'description');
    if (descriptionTag) summary = descriptionTag;
  }

  const communityRelays = communityDefEvent
    ? communityDefEvent.tags.filter((t) => t[0] === 'r' && t[1]).map((t) => t[1])
    : [];
  const allRelays = [...new Set([...baseRelays, ...communityRelays])];

  const events = await fetchEventsFromRelays(
    {
      kinds: [31922, 31923],
      '#h': [communityPubkey],
      limit: 500
    },
    allRelays
  );

  const ics = generateICSContent({ title, summary }, events, url);
  return icsResponse(ics, title || 'community-calendar');
}

/**
 * @param {string} body
 * @param {string} filenameStem
 * @returns {Response}
 */
function icsResponse(body, filenameStem) {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': encodeFilename(filenameStem),
      'Cache-Control': 'no-cache, must-revalidate',
      'X-Published-TTL': 'PT1H'
    }
  });
}

/**
 * @param {string} message
 * @param {number} status
 * @returns {Response}
 */
function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Build the ICS body. Pure — operates on plain Nostr events.
 *
 * @param {{title: string, summary: string}} calendarMetadata
 * @param {import('nostr-tools').NostrEvent[]} events
 * @param {URL} url
 * @returns {string}
 */
function generateICSContent(calendarMetadata, events, url) {
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
      // No end tag = open end (NIP-52: ends same day) — omit DTEND rather
      // than fabricating a duration.
      dtEndProperty = timing.end ? `DTEND:${formatDateTime(timing.end)}` : '';
    }

    const eventNaddr = eventToNaddr(event);
    const baseUrl = url.origin;
    const title = tagValue(event, 'title') || 'Untitled Event';
    const summary = tagValue(event, 'summary') || '';
    const location = tagValue(event, 'location');

    ics.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@edufeed.com`,
      dtStartProperty,
      dtEndProperty,
      `SUMMARY:${escapeText(title)}`,
      `DESCRIPTION:${escapeText(summary)}`,
      location ? `LOCATION:${escapeText(location)}` : '',
      `URL:${baseUrl}/calendar/event/${eventNaddr}`,
      `CREATED:${formatDateTime(event.created_at)}`,
      `LAST-MODIFIED:${formatDateTime(event.created_at)}`,
      'END:VEVENT'
    );
  }

  ics.push('END:VCALENDAR');
  return ics.filter((line) => line !== '').join('\r\n');
}
