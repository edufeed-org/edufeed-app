/**
 * Pure NIP-52 timing helpers with no store/config/i18n imports, safe for
 * server routes (e.g. the ICS export) as well as client code. Re-exported
 * from `$lib/helpers/calendar.js` for client callers.
 */

/**
 * Either shape the app passes calendar events around in: a raw Nostr event
 * (`tags`, `created_at`) or a transformed CalendarEvent (`dTag`, `createdAt`).
 *
 * @typedef {{
 *   id: string,
 *   kind: number,
 *   pubkey: string,
 *   tags?: string[][],
 *   created_at?: number,
 *   createdAt?: number,
 *   dTag?: string
 * }} AddressableLike
 */

/** ISO 8601 date pattern for NIP-52 kind 31922 (date-based) events */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const SECONDS_PER_DAY = 86400;

/**
 * Parse a NIP-52 calendar event time value to a Unix timestamp (seconds).
 * Handles both formats per NIP-52 spec:
 * - Kind 31922 (date-based): ISO 8601 date string "YYYY-MM-DD" → midnight UTC
 * - Kind 31923 (time-based): Unix timestamp string "1704067200"
 *
 * @param {string | undefined} value - The tag value to parse
 * @param {number} [_eventKind] - Optional event kind for format hints
 * @returns {number} Unix timestamp in seconds, or 0 if invalid
 */
export function parseCalendarTimestamp(value, _eventKind) {
  if (!value) return 0;

  // Date-based format: "YYYY-MM-DD" → midnight UTC
  if (ISO_DATE_PATTERN.test(value)) {
    const date = new Date(value + 'T00:00:00Z');
    return isNaN(date.getTime()) ? 0 : Math.floor(date.getTime() / 1000);
  }

  // Time-based format: Unix timestamp string
  const num = parseInt(value, 10);
  return isNaN(num) ? 0 : num;
}

/**
 * Start/end bounds for exporting a raw calendar event to ICS.
 *
 * - 31922: the app's writer stores the end date inclusively, so DTEND
 *   (exclusive per RFC 5545) is end + 1 day; without an end the event spans
 *   exactly its start day.
 * - 31923: the end timestamp is used as-is; without an end we return null so
 *   the exporter omits DTEND instead of fabricating a duration.
 *
 * @param {import('nostr-tools').NostrEvent} event
 * @returns {{ isAllDay: boolean, start: number, end: number | null } | null}
 */
export function getIcsEventTiming(event) {
  const tagValue = (/** @type {string} */ name) =>
    event.tags?.find((/** @type {string[]} */ t) => t[0] === name)?.[1];
  const start = parseCalendarTimestamp(tagValue('start'), event.kind);
  if (!start) return null;

  const isAllDay = event.kind === 31922;
  const endParsed = parseCalendarTimestamp(tagValue('end'), event.kind);

  if (isAllDay) {
    const end =
      endParsed && endParsed >= start ? endParsed + SECONDS_PER_DAY : start + SECONDS_PER_DAY;
    return { isAllDay, start, end };
  }
  return { isAllDay, start, end: endParsed && endParsed > start ? endParsed : null };
}

/**
 * The address key two events must share to count as the same appointment.
 *
 * NIP-52 splits one appointment across two kinds — 31922 while it is all-day,
 * 31923 once it has times — and replaceability is per kind:pubkey:d, so a
 * publisher that flips the kind under a stable d-tag leaves the old event
 * alive forever. (Observed on relay.edufeed.org: an importer rewrote its
 * timed events as all-day ones, and every rail then showed both.) The two
 * calendar kinds therefore share one key. A d-tag is required: without it
 * there is nothing that identifies the appointment across the flip.
 *
 * Accepts both shapes the app passes around: a raw Nostr event (`tags`,
 * `created_at`) and a transformed CalendarEvent (`dTag`, `createdAt`), so a
 * single helper serves the loaders, the models and the views.
 *
 * @param {AddressableLike} event
 * @returns {string | null} shared key, or null if the event has no twin identity
 */
function calendarTwinKey(event) {
  if (event.kind !== 31922 && event.kind !== 31923) return null;
  const dTag = event.dTag ?? event.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
  return dTag ? `calendar:${event.pubkey}:${dTag}` : null;
}

/** @param {AddressableLike} event */
function publishedAt(event) {
  return event.created_at ?? event.createdAt ?? 0;
}

/**
 * True when `candidate` beats `current` for the same address: newest
 * publish time wins, ties broken by lower id (NIP-01).
 *
 * @param {AddressableLike} candidate
 * @param {AddressableLike | undefined} current
 * @returns {boolean}
 */
function winsAddress(candidate, current) {
  if (!current) return true;
  if (publishedAt(candidate) !== publishedAt(current))
    return publishedAt(candidate) > publishedAt(current);
  return candidate.id < current.id;
}

/**
 * Collapse a raw event list to one event per replaceable address
 * (kind:pubkey:d, with the two calendar kinds sharing one address per
 * `calendarTwinKey`), keeping the NIP-01 winner (newest created_at, ties
 * broken by lower id). Non-replaceable kinds are deduped by id. Needed
 * wherever events are collected outside the EventStore (e.g. the ICS export
 * fetching from several relays) — otherwise an edited appointment can appear
 * twice.
 *
 * @template {AddressableLike} T
 * @param {T[]} events
 * @returns {T[]}
 */
export function dedupeReplaceableEvents(events) {
  /** @type {Map<string, T>} */
  const byKey = new Map();
  for (const event of events) {
    const replaceable = event.kind >= 30000 && event.kind < 40000;
    const dTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || '';
    const key =
      calendarTwinKey(event) ||
      (replaceable ? `${event.kind}:${event.pubkey}:${dTag}` : `id:${event.id}`);
    if (winsAddress(event, byKey.get(key))) byKey.set(key, event);
  }
  return [...byKey.values()];
}

/**
 * Collapse only cross-kind calendar twins, leaving every other item — and the
 * surviving order — exactly as it came in. Use this on mixed feeds, where
 * `dedupeReplaceableEvents` would also re-key notes, articles and shares.
 * Takes raw events or transformed CalendarEvents (see `calendarTwinKey`).
 *
 * @template {AddressableLike} T
 * @param {T[]} events
 * @returns {T[]}
 */
export function dedupeCalendarTwins(events) {
  /** @type {Map<string, T>} */
  const winners = new Map();
  for (const event of events) {
    const key = calendarTwinKey(event);
    if (key && winsAddress(event, winners.get(key))) winners.set(key, event);
  }
  if (winners.size === 0) return [...events];
  /** @type {Set<string>} */
  const emitted = new Set();
  return events.filter((event) => {
    const key = calendarTwinKey(event);
    if (!key) return true;
    if (winners.get(key) !== event || emitted.has(key)) return false;
    emitted.add(key);
    return true;
  });
}

/**
 * The `YYYY-MM-DD` an event form shows for a stored start/end timestamp.
 * Kind 31922 (all-day) values are midnight UTC and the writer reads the form
 * date back as UTC, so their day is the UTC day in every zone — local
 * getters would shift it back a day west of UTC on every edit. Kind 31923
 * values are instants, shown on the viewer's local day.
 *
 * @param {number} seconds - unix seconds
 * @param {number} kind - 31922 or 31923
 * @returns {string}
 */
export function formDateFromTimestamp(seconds, kind) {
  const date = new Date(seconds * 1000);
  if (kind === 31922) return date.toISOString().slice(0, 10);
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const HEX_PUBKEY = /^[0-9a-fA-F]{64}$/;

/**
 * A NIP-52 calendar event (31922/31923) h-tagged with a channel id — any
 * non-empty `h` value that is not a 64-hex community pubkey (either case) —
 * is a channel meeting. It lives on its channel's group relay only, so
 * generic calendar surfaces (personal calendar, feeds, discover, community
 * calendar) skip it, its edit/share/repost actions are hidden, and it is
 * never read from or written to the IDB cache. Its home is the channel's
 * MeetingCard.
 *
 * @param {{kind?: number, tags?: string[][]} | null | undefined} event
 * @returns {boolean}
 */
export function isChannelMeeting(event) {
  if (!event || (event.kind !== 31922 && event.kind !== 31923)) return false;
  return (event.tags ?? []).some((tag) => {
    if (tag[0] !== 'h' || typeof tag[1] !== 'string') return false;
    const value = tag[1].trim();
    // An empty/malformed h names nothing; a (any-case) 64-hex is a community.
    return value !== '' && !HEX_PUBKEY.test(value);
  });
}

/**
 * Drop channel meetings from a list of raw events or transformed
 * CalendarEvents (read through `originalEvent`).
 *
 * @template T
 * @param {T[]} events
 * @returns {T[]}
 */
export function withoutChannelMeetings(events) {
  return events.filter(
    (item) => !isChannelMeeting(/** @type {any} */ (item)?.originalEvent ?? item)
  );
}
