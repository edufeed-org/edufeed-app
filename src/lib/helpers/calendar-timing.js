/**
 * Pure NIP-52 timing helpers with no store/config/i18n imports, safe for
 * server routes (e.g. the ICS export) as well as client code. Re-exported
 * from `$lib/helpers/calendar.js` for client callers.
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
 * Collapse a raw event list to one event per replaceable address
 * (kind:pubkey:d), keeping the NIP-01 winner (newest created_at, ties broken
 * by lower id). Non-replaceable kinds are deduped by id. Needed wherever
 * events are collected outside the EventStore (e.g. the ICS export fetching
 * from several relays) — otherwise an edited appointment can appear twice.
 *
 * @template {import('nostr-tools').NostrEvent} T
 * @param {T[]} events
 * @returns {T[]}
 */
export function dedupeReplaceableEvents(events) {
  /** @type {Map<string, T>} */
  const byKey = new Map();
  for (const event of events) {
    const replaceable = event.kind >= 30000 && event.kind < 40000;
    const dTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || '';
    const key = replaceable ? `${event.kind}:${event.pubkey}:${dTag}` : `id:${event.id}`;
    const current = byKey.get(key);
    if (
      !current ||
      event.created_at > current.created_at ||
      (event.created_at === current.created_at && event.id < current.id)
    ) {
      byKey.set(key, event);
    }
  }
  return [...byKey.values()];
}
