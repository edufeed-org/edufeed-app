// Pure helpers for scheduled meetings in NIP-29 channels.
//
// A meeting is a NIP-52 kind 31923 event with EXACTLY ONE `["h", groupId]`
// tag, published only to the channel's group relay (never the outbox model,
// never a community-pubkey h-tag — see
// docs/superpowers/sdd/2026-10-02-scheduled-meetings/global-constraints.md).
// A guest link is a call pass (kind 9025, no `scope: 'call'`) linked to the
// meeting via an `["a", "<coordinate>", relay]` tag — see
// `src/lib/groups/call-passes.js` and `docs/nips/nip29-call-passes.md`.
//
// Plain module (no runes) — called from modal/card components and tested in
// node.
import { buildCalendarEventTags, convertFormDataToEvent } from '$lib/helpers/calendar.js';

/** NIP-52 time-based calendar event kind used for all scheduled meetings. */
export const MEETING_KIND = 31923;
/** Guests (and members) may join starting this many seconds before `start`. */
export const GUEST_EARLY_S = 900;
/** A guest link stays valid this many seconds after `end`. */
export const GUEST_LATE_S = 1800;
/** The relay's maximum call-pass lifetime (pyramid `callPassMaxLifetime`). */
export const PASS_MAX_LIFETIME_S = 60 * 86400;
/** A meeting without a (usable) end lasts an hour. */
export const MEETING_DEFAULT_DURATION_S = 3600;
/** The channel's meeting bar shows meetings starting within this window. */
export const BAR_LOOKAHEAD_S = 24 * 3600;

/**
 * Build NIP-52 tags for a channel meeting: reuses the normal calendar tag
 * builder with no community h-tags, then appends exactly one group-id h-tag
 * and overwrites `location` with the channel's member URL — a meeting must
 * never carry a community pubkey h-tag, and its location must never be (or
 * leak) a pass code.
 *
 * @param {import('../types/calendar.js').EventFormData} formData
 * @param {{groupId: string, dTag: string, channelUrl: string}} opts
 * @returns {string[][]}
 */
export function buildMeetingTags(formData, { groupId, dTag, channelUrl }) {
  // The second arg is the community pubkey `convertFormDataToEvent` stamps
  // onto `eventData.communityPubkey` — unused here since `buildCalendarEventTags`
  // is called below with an explicit empty h-tag list, not `eventData.communityPubkey`.
  const eventData = convertFormDataToEvent(formData, '');
  const tags = buildCalendarEventTags(formData, eventData, dTag, []).filter(
    (tag) => tag[0] !== 'location'
  );
  tags.push(['location', channelUrl]);
  tags.push(['h', groupId]);
  return tags;
}

/**
 * The NIP-52 replaceable-event coordinate (`kind:pubkey:d`) for a meeting
 * event — used to link a call pass's `a` tag back to the meeting.
 *
 * @param {{kind?: number, pubkey: string, tags: string[][]}} event
 * @returns {string}
 */
export function meetingCoordinate(event) {
  const dTag = event.tags?.find((tag) => tag[0] === 'd')?.[1] || '';
  return `${event.kind ?? MEETING_KIND}:${event.pubkey}:${dTag}`;
}

/**
 * The call pass window for a meeting's guest link: opens `GUEST_EARLY_S`
 * before `start`, stays valid until `GUEST_LATE_S` after `end`.
 *
 * @param {{start: number, end: number}} meeting
 * @returns {{notBefore: number, expiration: number}}
 */
export function guestWindow({ start, end }) {
  return { notBefore: start - GUEST_EARLY_S, expiration: end + GUEST_LATE_S };
}

/**
 * Whether a guest link can be created at all: the relay rejects any pass
 * expiring more than `PASS_MAX_LIFETIME_S` from now.
 *
 * @param {{end: number}} meeting
 * @param {number} nowS - current time, unix seconds
 * @returns {boolean}
 */
export function canHaveGuestLink({ end }, nowS) {
  return end + GUEST_LATE_S <= nowS + PASS_MAX_LIFETIME_S;
}

/**
 * Where a meeting stands relative to now, for card/bar status and
 * join-button gating:
 * - `upcoming` — before the guest-early window opens
 * - `joinable` — `start - GUEST_EARLY_S <= now < start`
 * - `running` — `start <= now < end`
 * - `past` — `now >= end`
 *
 * @param {{start: number, end?: number}} meeting
 * @param {number} nowS - current time, unix seconds
 * @returns {'upcoming' | 'joinable' | 'running' | 'past'}
 */
export function meetingPhase({ start, end }, nowS) {
  const effectiveEnd = end ?? start;
  if (nowS < start - GUEST_EARLY_S) return 'upcoming';
  if (nowS < start) return 'joinable';
  if (nowS < effectiveEnd) return 'running';
  return 'past';
}

/**
 * True when `event` is a meeting (kind 31923) belonging to exactly this
 * group — i.e. it carries exactly one `h` tag and it equals `groupId`.
 * Guards against a malformed/foreign event with zero or multiple h-tags.
 *
 * @param {{kind?: number, tags?: string[][]}} event
 * @param {string} groupId
 * @returns {boolean}
 */
export function isMeetingForGroup(event, groupId) {
  if (event?.kind !== MEETING_KIND) return false;
  const hTags = (event.tags || []).filter((tag) => tag[0] === 'h');
  return hTags.length === 1 && hTags[0][1] === groupId;
}

/**
 * @param {string | number} text
 * @returns {string}
 */
function escapeIcsText(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * @param {number} tsSeconds - unix seconds
 * @returns {string} `YYYYMMDDTHHMMSSZ`
 */
function formatIcsDateTimeUtc(tsSeconds) {
  const date = new Date(tsSeconds * 1000);
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * A stable UID for the meeting coordinate (or caller-given value), made safe
 * for the UID content line: trimmed, internal whitespace/newlines collapsed,
 * non-printable-ASCII characters dropped (a coordinate is plain
 * `kind:pubkey:d` so this never touches real content).
 *
 * @param {string | undefined} value
 * @returns {string} `''` when `value` is missing/empty
 */
function sanitizeIcsUid(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\x21-\x7e]/g, '');
}

/** RFC 5545 §3.1: content lines SHOULD NOT exceed this many octets. */
const ICS_MAX_LINE_OCTETS = 75;

/**
 * RFC 5545 line folding: a content line longer than 75 octets (UTF-8 bytes,
 * excluding the line break) is split with CRLF + a single leading space on
 * each continuation line. Splits only on UTF-8 character boundaries — never
 * mid multi-byte sequence — by backing off the chunk boundary past any
 * continuation bytes (`10xxxxxx`).
 *
 * @param {string} line
 * @returns {string}
 */
function foldIcsLine(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= ICS_MAX_LINE_OCTETS) return line;

  const decoder = new TextDecoder('utf-8');
  const chunks = [];
  let start = 0;
  // The first line may use the full 75 octets; continuation lines reserve
  // one octet for their mandatory leading space.
  let limit = ICS_MAX_LINE_OCTETS;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end--;
    }
    chunks.push(decoder.decode(bytes.slice(start, end)));
    start = end;
    limit = ICS_MAX_LINE_OCTETS - 1;
  }
  return chunks.join('\r\n ');
}

/**
 * Build a minimal single-VEVENT .ics file for a meeting, matching the
 * escaping/CRLF/line-folding conventions of RFC 5545 and the calendar
 * export (`src/routes/api/calendar/[id]/ics/+server.js`): times are always
 * UTC (meetings are always kind 31923 / timed), text fields are escaped,
 * long content lines are folded without breaking a UTF-8 character.
 *
 * `uid`, when given, should be the meeting's coordinate
 * (`meetingCoordinate(event)`) so the UID stays stable across reschedules —
 * a recreated .ics for the same meeting (e.g. after editing start/end)
 * updates the same calendar entry in the guest's client instead of adding a
 * duplicate. Without one, a UID derived from start/end is used (only safe
 * when the meeting itself never changes).
 *
 * @param {{title: string, start: number, end: number, description?: string,
 *   url: string, uid?: string, nowS?: number}} meeting
 * @returns {string}
 */
export function buildMeetingIcs({ title, start, end, description, url, uid, nowS }) {
  const sanitizedUid = sanitizeIcsUid(uid);
  const finalUid = sanitizedUid ? `${sanitizedUid}@edufeed` : `meeting-${start}-${end}@edufeed`;
  const stamp = formatIcsDateTimeUtc(nowS ?? Math.floor(Date.now() / 1000));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Edufeed//Meeting//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${finalUid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${formatIcsDateTimeUtc(start)}`,
    `DTEND:${formatIcsDateTimeUtc(end)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(description || '')}`,
    `URL:${url}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return lines.map(foldIcsLine).join('\r\n');
}

/**
 * A filesystem-safe `.ics` filename derived from a meeting title.
 *
 * @param {string | undefined} title
 * @returns {string}
 */
export function icsFileName(title) {
  const base = String(title ?? '').trim();
  const safe = base
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return `${safe || 'meeting'}.ics`;
}

/**
 * The newest call pass (kind 9025) linked to a meeting via its `a` tag —
 * used to rebuild "Gast-Link kopieren" from an already-published pass.
 *
 * @param {Array<{created_at?: number, tags?: string[][]}>} passes
 * @param {string} coordinate - `meetingCoordinate(event)`
 * @returns {any | null}
 */
export function findMeetingPass(passes, coordinate) {
  let best = null;
  for (const pass of passes || []) {
    const aTag = pass?.tags?.find((tag) => tag[0] === 'a');
    if (!aTag || aTag[1] !== coordinate) continue;
    if (!best || (pass.created_at ?? 0) > (best.created_at ?? 0)) best = pass;
  }
  return best;
}

/**
 * A meeting's start/end in unix seconds, read from its NIP-52 tags. A
 * missing end (or one not after the start) means it lasts
 * `MEETING_DEFAULT_DURATION_S` — the same fallback the scheduler uses for
 * the guest window. Null when the start is missing or unreadable.
 *
 * @param {{tags?: string[][]}} event
 * @returns {{start: number, end: number} | null}
 */
export function meetingTimes(event) {
  const read = (/** @type {string} */ name) => {
    const raw = event?.tags?.find((tag) => tag[0] === name)?.[1];
    const n = raw === undefined || raw === '' ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const start = read('start');
  if (start === null) return null;
  const end = read('end');
  return { start, end: end !== null && end > start ? end : start + MEETING_DEFAULT_DURATION_S };
}

/**
 * The meeting the channel's bar announces: running, joinable, or starting
 * within `BAR_LOOKAHEAD_S` — the earliest start wins (a running meeting
 * always started before one still ahead). Null when there is none.
 *
 * @template {{tags?: string[][]}} E
 * @param {E[]} events - this channel's meetings (already group-filtered)
 * @param {number} nowS
 * @returns {{event: E, start: number, end: number,
 *   phase: 'upcoming' | 'joinable' | 'running'} | null}
 */
export function nextBarMeeting(events, nowS) {
  /** @type {{event: E, start: number, end: number, phase: 'upcoming' | 'joinable' | 'running'} | null} */
  let best = null;
  for (const event of events || []) {
    const times = meetingTimes(event);
    if (!times) continue;
    const phase = meetingPhase(times, nowS);
    if (phase === 'past') continue;
    if (phase === 'upcoming' && times.start - nowS > BAR_LOOKAHEAD_S) continue;
    if (!best || times.start < best.start) best = { event, ...times, phase };
  }
  return best;
}
