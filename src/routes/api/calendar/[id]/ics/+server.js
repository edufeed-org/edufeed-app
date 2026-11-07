import { nip19 } from 'nostr-tools';
import {
  getCalendarRelaysServer,
  safeHintRelays,
  decodeIdentifier,
  fetchEventFromRelays,
  fetchEventsFromRelays,
  deletionFiltersFor,
  dropDeletedEvents
} from '$lib/server/nostr-fetch.js';
import { tagValue, generateICSContent } from '$lib/server/calendar-ics.js';
import { getRelaysForKind } from '$lib/server/relay-fetch.js';
import { parseCommunityContentTypes } from '$lib/helpers/communityRelays.js';
import { deriveCommunityType, parseMembershipPointer } from '$lib/groups/community-membership.js';
import { rosterFromEvents } from '$lib/groups/root-roster.js';
import { sectionAllowedAuthors } from '$lib/groups/roster-access.js';
import { moderationPubkeys } from '$lib/groups/roles.js';
import { SECTION_OVERRIDE_KIND, applySectionOverride } from '$lib/groups/section-override.js';

/**
 * Server-side ICS feed for both NIP-52 calendars (`naddr`) and community
 * calendars (hex pubkey / npub). Fetches events from relays directly via
 * `$lib/server/nostr-fetch.js` so this endpoint does not depend on the
 * browser-only EventStore + runtimeConfig stack. Those fetchers only accept
 * verified, filter-matching events and keep the newest revision; relay hints
 * (naddr, `a` tags, community `r` tags) are SSRF-guarded and queried after
 * the configured relays; NIP-09 deletions by the authors are honoured.
 */

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i;
const CALENDAR_EVENT_KINDS = [31922, 31923];
/** Upper bound on the `a` tags one calendar may make us resolve. */
const MAX_A_TAGS = 500;
/** Distinct `a`-tag relay hints worth a DNS check (the fetch caps sockets at 7 anyway). */
const MAX_A_TAG_HINTS = 4;

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
 * Safely encode filename for Content-Disposition header (RFC 5987).
 * @param {string} filename
 * @returns {string}
 */
function encodeFilename(filename) {
  const name = filename.replace(/\.ics$/, '');
  // `"` and `\` would end or escape the quoted-string; drop them with non-ASCII.
  const asciiFallback = name.replace(/[^\x20-\x7E]|["\\]/g, '').trim() || 'calendar';
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

  const relays = getCalendarRelaysServer(await safeHintRelays(decoded.relays));

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

  const found = await fetchReferencedEvents(calendar);

  const deletions = await fetchDeletions([calendar, ...found], relays);
  if (dropDeletedEvents([calendar], deletions).length === 0) {
    return jsonError('Calendar not found', 404);
  }
  const events = dropDeletedEvents(found, deletions);

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
    ? await safeHintRelays(
        communityDefEvent.tags.filter((t) => t[0] === 'r' && t[1]).map((t) => t[1])
      )
    : [];
  const allRelays = getCalendarRelaysServer(communityRelays);

  const [fetched, allowedAuthors] = await Promise.all([
    fetchEventsFromRelays(
      {
        kinds: CALENDAR_EVENT_KINDS,
        '#h': [communityPubkey],
        limit: 500
      },
      allRelays
    ),
    communityDefEvent && deriveCommunityType(communityDefEvent) === 'moderated'
      ? fetchRosterAllowedAuthors(communityDefEvent, communityRelays)
      : fetchCalendarAllowedAuthors(communityDefEvent, allRelays)
  ]);
  const permitted = allowedAuthors
    ? fetched.filter((ev) => allowedAuthors.has(ev.pubkey))
    : fetched;
  const events = dropDeletedEvents(permitted, await fetchDeletions(permitted, allRelays));

  const ics = generateICSContent({ title, summary }, events, url);
  return icsResponse(ics, title || 'community-calendar');
}

/**
 * Resolve the events a kind-31924 calendar lists in its `a` tags
 * (`kind:pubkey:d`, optional relay hint) with one REQ: one filter per kind
 * carrying every author and d-tag. The authors × d-tags cross product can match
 * coordinates the calendar does not list, so results are narrowed back to the
 * listed ones, keeping the newest revision of each.
 * @param {import('nostr-tools').NostrEvent} calendar
 * @returns {Promise<import('nostr-tools').NostrEvent[]>}
 */
async function fetchReferencedEvents(calendar) {
  /** @type {Map<number, { authors: Set<string>, dTags: Set<string> }>} */
  const byKind = new Map();
  /** @type {Set<string>} */
  const wanted = new Set();
  /** @type {Set<string>} */
  const hints = new Set();

  for (const tag of calendar.tags.filter((t) => t[0] === 'a').slice(0, MAX_A_TAGS)) {
    const parts = (tag[1] || '').split(':');
    if (parts.length < 3) continue;
    const [kindStr, pubkey, ...dParts] = parts;
    const kind = Number.parseInt(kindStr, 10);
    if (!CALENDAR_EVENT_KINDS.includes(kind) || !HEX_PUBKEY_RE.test(pubkey)) continue;
    const dTag = dParts.join(':');

    const entry = byKind.get(kind) ?? { authors: new Set(), dTags: new Set() };
    entry.authors.add(pubkey);
    entry.dTags.add(dTag);
    byKind.set(kind, entry);
    wanted.add(`${kind}:${pubkey}:${dTag}`);
    if (tag[2]) hints.add(tag[2]);
  }
  if (byKind.size === 0) return [];

  const filters = [...byKind].map(([kind, { authors, dTags }]) => ({
    kinds: [kind],
    authors: [...authors],
    '#d': [...dTags]
  }));
  const relays = getCalendarRelaysServer(
    await safeHintRelays([...hints].slice(0, MAX_A_TAG_HINTS))
  );
  const fetched = (await fetchEventsFromRelays(filters, relays)) || [];

  /** @type {Map<string, import('nostr-tools').NostrEvent>} */
  const newest = new Map();
  for (const ev of fetched) {
    const address = `${ev.kind}:${ev.pubkey}:${tagValue(ev, 'd') ?? ''}`;
    if (!wanted.has(address)) continue;
    const prev = newest.get(address);
    if (!prev || ev.created_at > prev.created_at) newest.set(address, ev);
  }
  return [...newest.values()];
}

/**
 * The community's allowed calendar authors — the same rule the /c page
 * applies client-side (`useProfileListAccess` → `filterEventsByAccess`): the
 * section holding the calendar kinds names a kind-30000 profile list, and only
 * its `p` members' events are shown. A list that cannot be found allows nobody,
 * as on the client.
 * @param {import('nostr-tools').NostrEvent | null} communityDefEvent
 * @param {string[]} relays
 * @returns {Promise<Set<string> | null>} null when the calendar is not gated
 */
async function fetchCalendarAllowedAuthors(communityDefEvent, relays) {
  const section = calendarSection(communityDefEvent);
  if (!section?.profileList) return null;

  const [, pubkey, ...idParts] = section.profileList.split(':');
  if (!HEX_PUBKEY_RE.test(pubkey ?? '')) return new Set();
  const hint = section.profileListRelay ? await safeHintRelays([section.profileListRelay]) : [];
  const list = await fetchEventFromRelays(
    { kinds: [30000], authors: [pubkey], '#d': [idParts.join(':')], limit: 1 },
    [...new Set([...hint, ...relays])]
  );
  return new Set((list?.tags ?? []).filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]));
}

/**
 * Allowed calendar authors of a MODERATED community — the client rule
 * (`useCommunityAccess` → `sectionAllowedAuthors`): the calendar section's
 * `access` tier against the root group's roster (39001 admins + 39002
 * members) from the `membership` pointer's relay, the owner always allowed,
 * with the sections a moderator's kind-30223 override reshapes
 * (`useEffectiveCommunity`). A roster that cannot be fetched allows only the
 * owner, like an empty one.
 * @param {import('nostr-tools').NostrEvent} communityDefEvent
 * @param {string[]} communityRelays SSRF-guarded community `r` relays
 * @returns {Promise<Set<string> | null>} null when the calendar is not gated
 */
async function fetchRosterAllowedAuthors(communityDefEvent, communityRelays) {
  const pointer = /** @type {{id: string, relay: string}} */ (
    parseMembershipPointer(communityDefEvent)
  );
  const owner = communityDefEvent.pubkey;
  // Same relays the client reads overrides from: communikey + community relays.
  const overrideRelays = getRelaysForKind(10222, communityRelays);
  const [rosterEvents, overrides] = await Promise.all([
    fetchEventsFromRelays(
      { kinds: [39001, 39002], '#d': [pointer.id] },
      await safeHintRelays([pointer.relay])
    ),
    fetchEventsFromRelays({ kinds: [SECTION_OVERRIDE_KIND], '#d': [owner] }, overrideRelays)
  ]);
  const roster = rosterFromEvents(pointer, rosterEvents ?? []);
  const liveOverrides = dropDeletedEvents(
    overrides ?? [],
    await fetchDeletions(overrides ?? [], overrideRelays)
  );
  const { event } = applySectionOverride(
    communityDefEvent,
    liveOverrides,
    moderationPubkeys(roster.admins)
  );
  const allowed = sectionAllowedAuthors(calendarSection(event), roster, owner);
  return allowed ? new Set(allowed) : null;
}

/**
 * @param {any} communityEvent kind 10222
 * @returns {import('$lib/helpers/communityRelays.js').ContentTypeConfig | null}
 */
function calendarSection(communityEvent) {
  return (
    parseCommunityContentTypes(communityEvent).find((s) =>
      s.kinds.some((k) => CALENDAR_EVENT_KINDS.includes(k))
    ) ?? null
  );
}

/**
 * NIP-09 deletions of `events` by their own authors (one REQ: `#a` for the
 * addresses, `#e` for the ids).
 * @param {import('nostr-tools').NostrEvent[]} events
 * @param {string[]} relays
 * @returns {Promise<import('nostr-tools').NostrEvent[]>}
 */
async function fetchDeletions(events, relays) {
  const filters = deletionFiltersFor(events);
  if (filters.length === 0) return [];
  return (await fetchEventsFromRelays(filters, relays)) || [];
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
