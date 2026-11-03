/**
 * Calendar Helper Functions
 * Utilities for date formatting, event management, and calendar operations
 */

import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { getSeenRelays, normalizeURL } from 'applesauce-core/helpers';
import { activeDateLocale, formatDate } from '$lib/helpers/dates.js';
import { normalizeHashtags } from '$lib/helpers/hashtags.js';
import * as m from '$lib/paraglide/messages';
import {
  parseCalendarTimestamp,
  getIcsEventTiming,
  allDayEndTagValue,
  calendarEventEnd,
  dedupeReplaceableEvents,
  dedupeCalendarTwins
} from '$lib/helpers/calendar-timing.js';
import { buildCalendarEventAttributeTags } from '$lib/helpers/calendar-attributes.js';

// Pure timing helpers live in calendar-timing.js (no store/config imports, so
// server routes can use them too); re-exported here for client callers.
export { parseCalendarTimestamp, getIcsEventTiming, dedupeReplaceableEvents, dedupeCalendarTwins };

/**
 * @typedef {import('../types/calendar.js').CalendarEvent} CalendarEvent
 * @typedef {import('../types/calendar.js').EventFormData} EventFormData
 */

/**
 * Format a unix timestamp as a relative time string (e.g. "3m ago", "2d ago")
 * Falls back to short date format (e.g. "Mar 6") for dates older than a week.
 * @param {number} unixSeconds - Unix timestamp in seconds
 * @returns {string} Relative time string
 */
export function formatRelativeTime(unixSeconds) {
  const diff = Date.now() - unixSeconds * 1000;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return formatCalendarDate(new Date(unixSeconds * 1000), 'short');
}

/**
 * Format a date for calendar display using configured locale
 * @param {Date} date - Date to format
 * @param {string} format - Format string ('YYYY-MM-DD', 'MM/DD', 'full', 'long', 'short', 'time')
 * @param {{ utc?: boolean, timeZone?: string }} [options] - utc: format in UTC
 *   (date-based events are anchored at UTC midnight, so local-time rendering
 *   shifts the day west of UTC); timeZone: format in this IANA zone instead of
 *   the viewer's (must be valid — see isValidTimeZone)
 * @returns {string} Formatted date string
 */
export function formatCalendarDate(date, format, { utc = false, timeZone } = {}) {
  if (!date || !(date instanceof Date)) return '';

  // The app (Paraglide) locale, not the deployment's CALENDAR_LOCALE: the
  // English UI showed "Oktober 2026" (QA round 3 K5).
  const locale = activeDateLocale();
  const use24Hour = runtimeConfig.calendar.timeFormat === '24h';
  const tz = utc ? { timeZone: 'UTC' } : timeZone ? { timeZone } : {};

  switch (format) {
    case 'YYYY-MM-DD':
      return date.toISOString().split('T')[0];
    case 'MM/DD':
      // For European format, use DD.MM
      return `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}`;
    case 'full':
    case 'long':
      return date.toLocaleDateString(locale, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        ...tz
      });
    case 'short':
      return date.toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
        ...tz
      });
    case 'month':
      return date.toLocaleDateString(locale, {
        year: 'numeric',
        month: 'long',
        ...tz
      });
    case 'time':
      return date.toLocaleTimeString(locale, {
        hour: 'numeric',
        minute: '2-digit',
        hour12: !use24Hour,
        ...tz
      });
    default:
      return date.toLocaleDateString(locale, tz);
  }
}

/**
 * Get array of dates for week view
 * @param {Date} date - Reference date (any day in the week)
 * @returns {Date[]} Array of 7 dates representing the week
 */
export function getWeekDates(date) {
  const weekStartDay = runtimeConfig.calendar.weekStartDay;
  const startOfWeek = new Date(date);
  const day = startOfWeek.getDay();

  // Calculate difference to get to the configured start of week
  const diff = startOfWeek.getDate() - ((day - weekStartDay + 7) % 7);
  startOfWeek.setDate(diff);

  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    const weekDate = new Date(startOfWeek);
    weekDate.setDate(startOfWeek.getDate() + i);
    weekDates.push(weekDate);
  }
  return weekDates;
}

/**
 * Get array of dates for month view (including padding days)
 * @param {Date} date - Reference date (any day in the month)
 * @returns {Date[]} Array of dates for calendar grid (42 days)
 */
export function getMonthDates(date) {
  const weekStartDay = runtimeConfig.calendar.weekStartDay;
  const year = date.getFullYear();
  const month = date.getMonth();

  // First day of the month
  const firstDay = new Date(year, month, 1);

  // Start from the configured start day of the week containing the first day
  const startDate = new Date(firstDay);
  const firstDayOfWeek = firstDay.getDay();
  const diff = (firstDayOfWeek - weekStartDay + 7) % 7;
  startDate.setDate(firstDay.getDate() - diff);

  // Generate 42 days (6 weeks) for consistent grid
  const monthDates = [];
  for (let i = 0; i < 42; i++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + i);
    monthDates.push(currentDate);
  }

  return monthDates;
}

/**
 * Check if an event falls within a date range using UTC comparisons.
 *
 * Not used by `filterEventsByViewMode` any more (see there) — comparing a
 * real instant against a range whose boundaries are the view's local days
 * reinterpreted as UTC instants shifts by the viewer's offset, same bug
 * class as the grid's old day-bucketing. Kept exported for any caller that
 * truly wants a UTC-instant-vs-UTC-range check.
 * @param {CalendarEvent} event - Calendar event to check
 * @param {Date} start - Start of date range (should be UTC date with time precision)
 * @param {Date} end - End of date range (should be UTC date with time precision)
 * @returns {boolean} True if event overlaps with date range
 */
export function isEventInDateRange(event, start, end) {
  if (!event || !event.start) return false;

  // Convert UNIX timestamps to UTC dates for comparison
  // event.start and event.end are UNIX timestamps (seconds)
  const eventStartDateUTC = new Date(event.start * 1000);
  // A 31922 CalendarEvent's end is the midnight of its last day (or absent
  // for a one-day event), so its exclusive end is the following midnight —
  // see getEffectiveEventEnd. A 31923 end is exclusive as-is.
  const eventEndDateUTC =
    event.kind === 31922
      ? new Date(getEffectiveEventEnd(event) * 1000)
      : event.end
        ? new Date(event.end * 1000)
        : eventStartDateUTC; // Same day if no end

  // Use the provided date range directly - they already have proper time precision
  // Previously, we were recreating UTC dates which lost the time information (00:00:00 always)
  // This caused events to be filtered out incorrectly in list view

  // Check for overlap: eventStart < rangeEnd AND eventEnd > rangeStart
  // Note: the end is exclusive, so we use > instead of >=
  return eventStartDateUTC < end && eventEndDateUTC > start;
}

const DAY_SECONDS = 86400;

/**
 * Integer calendar-day index for a Date's LOCAL y/m/d (the runtime's
 * configured zone: the viewer's zone in a browser, `TZ` in Node). Built via
 * `Date.UTC` purely as an arithmetic trick so day indices are cheap to
 * compare and add/subtract — it does not mean the day is "in UTC".
 * Comparable to the day indices `createDateKey` strings encode, and to
 * `dayIndexFromKey` in calendar-lanes.js (both use the same trick on a
 * calendar-date label).
 *
 * @param {Date} date
 * @returns {number}
 */
function calendarDayIndex(date) {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 1000 / DAY_SECONDS
  );
}

/**
 * The calendar-day index a timestamp belongs to, in the frame its event kind
 * calls for:
 *  - 31922 (date-based): the stored value already IS a UTC calendar date
 *    (midnight UTC) — its day is the plain UTC day, the same for every
 *    viewer, and must not shift with the viewer's zone.
 *  - anything else, in particular 31923 (time-based): a real instant — it
 *    belongs on whichever calendar day it falls on for the viewer, so this
 *    uses the runtime's local getters (see calendarDayIndex).
 *
 * @param {number} seconds - unix seconds
 * @param {number | undefined} kind
 * @returns {number}
 */
function dayIndexForKind(seconds, kind) {
  if (kind === 31922) return Math.floor(seconds / DAY_SECONDS);
  return calendarDayIndex(new Date(seconds * 1000));
}

/**
 * The day span an event covers, as integer day indices comparable to
 * `createDateKey` / `dayIndexFromKey` day numbers. The frame depends on the
 * event's kind (see `dayIndexForKind`): the UTC calendar day for 31922
 * (date-based — the stored value already is one, unaffected by the viewer's
 * zone), the viewer's local calendar day for 31923 (time-based — a real
 * instant, shown on whichever day it falls on for the person looking at the
 * grid).
 *
 * End-bound conventions differ by kind:
 *  - 31922 (date-based): a CalendarEvent's end is the midnight of the last
 *    day (the exclusive NIP-52 end tag minus one day, see
 *    `calendarEventEnd`), so the end day itself counts.
 *  - 31923 (time-based): NIP-52 ends are exclusive — an event ending exactly
 *    at midnight must not bleed into the next day.
 * Implausible spans are capped at 92 days.
 *
 * @param {CalendarEvent} event
 * @param {number} [startTimestamp] - pre-parsed start (avoids re-parsing)
 * @returns {{startDay: number, endDay: number}}
 */
export function getEventDaySpan(event, startTimestamp) {
  const MAX_SPAN_DAYS = 92;

  const start =
    startTimestamp ??
    (typeof event.start === 'number' ? event.start : parseCalendarTimestamp(String(event.start)));
  const endTimestamp =
    typeof event.end === 'number' ? event.end : parseCalendarTimestamp(String(event.end ?? ''));

  const startDay = dayIndexForKind(start, event.kind);
  let endDay = startDay;
  if (endTimestamp && endTimestamp > start) {
    const effectiveEnd = event.kind === 31922 ? endTimestamp : endTimestamp - 1;
    endDay = Math.max(startDay, dayIndexForKind(effectiveEnd, event.kind));
    if (endDay - startDay > MAX_SPAN_DAYS) {
      console.warn(
        '📅 getEventDaySpan: Capping implausible event span of',
        endDay - startDay,
        'days for event:',
        event.title || event.id
      );
      endDay = startDay + MAX_SPAN_DAYS;
    }
  }
  return { startDay, endDay };
}

/**
 * NIP-52: kind 31922 is date-based (all-day) — no time may ever be displayed
 * for it, not even 00:00. Times belong to kind 31923 only.
 * @param {{ kind?: number } | undefined | null} event
 * @returns {boolean}
 */
export function isAllDayEvent(event) {
  return event?.kind === 31922;
}

/**
 * When an event effectively ends, as a unix timestamp (seconds).
 *
 * Kind 31922 (date-based): a missing `end` means an open end on the same
 * day as `start`; with an `end` present, it ends at the end of its
 * (inclusive) end day — both via getEventDaySpan.
 *
 * Kind 31923 (time-based): `end` is an exclusive unix timestamp, so a
 * present-and-later `end` ends exactly then. NIP-52: "If omitted, the
 * calendar event ends instantaneously" — so a missing (or not-after-start)
 * `end` means the event ends at `start`, not at the end of that day.
 *
 * @param {CalendarEvent} event
 * @returns {number}
 */
export function getEffectiveEventEnd(event) {
  const SECONDS_PER_DAY = 86400;
  const start = typeof event.start === 'number' ? event.start : 0;
  if (event.kind === 31922) {
    const { endDay } = getEventDaySpan(event, start);
    return (endDay + 1) * SECONDS_PER_DAY;
  }
  if (event.end && event.end > start) return event.end;
  return start;
}

/**
 * Parse a raw calendar `start` tag value into a Date plus display flags.
 * Numeric values are unix timestamps, anything else is handed to Date()
 * (ISO "YYYY-MM-DD" → UTC midnight). Whether a time may be shown is decided
 * by the event kind — never by the value shape — falling back to the shape
 * only for legacy callers that don't know the kind.
 *
 * @param {string | undefined | null} startStr
 * @param {number | undefined} kind
 * @returns {{ date: Date, showTime: boolean, utc: boolean } | null}
 */
function parseCalendarStartValue(startStr, kind) {
  if (!startStr) return null;
  const num = Number(startStr);
  const numeric = !isNaN(num) && num > 0;
  const date = numeric ? new Date(num * 1000) : new Date(startStr);
  if (isNaN(date.getTime())) return null;
  const showTime = kind === 31923 ? true : kind === 31922 ? false : numeric;
  // ISO date strings parse as UTC midnight — render them in UTC so the day
  // doesn't shift west of the prime meridian.
  return { date, showTime, utc: !numeric || kind === 31922 };
}

/**
 * Parse a calendar `start` tag into feed-card date-row parts.
 * Returns null when the value is unparseable so callers can fall back to
 * plain text.
 *
 * @param {string | undefined | null} startStr
 * @param {number | undefined} [kind] - 31922 or 31923 when known
 * @returns {{ day: string, month: string, when: string } | null}
 */
export function parseCalendarStartParts(startStr, kind) {
  const parsed = parseCalendarStartValue(startStr, kind);
  if (!parsed) return null;
  const { date, showTime, utc } = parsed;
  const locale = activeDateLocale();
  const tz = utc ? { timeZone: 'UTC' } : {};
  const when = showTime
    ? `${date.toLocaleDateString(locale, { year: 'numeric', ...tz })}, ${date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', ...tz })}`
    : `${date.toLocaleDateString(locale, { weekday: 'long', ...tz })}, ${date.toLocaleDateString(locale, { year: 'numeric', ...tz })}`;
  return {
    day: date.toLocaleDateString(locale, { day: 'numeric', ...tz }),
    month: date.toLocaleDateString(locale, { month: 'short', ...tz }),
    when
  };
}

/**
 * One-line date(/time) subtitle for a calendar event, from its raw `start`
 * tag value. All-day events (31922) get the date only (DD.MM.YYYY); timed
 * events (31923) get date + time. Unparseable input is returned as-is.
 *
 * @param {string | undefined | null} startStr
 * @param {number | undefined} [kind]
 * @returns {string}
 */
export function formatCalendarSubtitle(startStr, kind) {
  const parsed = parseCalendarStartValue(startStr, kind);
  if (!parsed) return startStr || '';
  const { date, showTime, utc } = parsed;
  const tz = utc ? { timeZone: 'UTC' } : {};
  const dateStr = formatDate(date, { day: '2-digit', month: '2-digit', year: 'numeric', ...tz });
  if (!showTime) return dateStr;
  const timeStr = date.toLocaleTimeString(activeDateLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    ...tz
  });
  return `${dateStr}, ${timeStr}`;
}

/**
 * Date(/time) line for a CalendarEvent wrapper (map popups etc.).
 * All-day events show the date only — never a fabricated 00:00.
 *
 * @param {CalendarEvent} event
 * @returns {string}
 */
export function formatEventDateTime(event) {
  if (!event?.start) return '';
  const allDay = isAllDayEvent(event);
  const startDate = new Date(event.start * 1000);
  const dateStr = formatCalendarDate(startDate, 'short', { utc: allDay });
  if (allDay) return dateStr;
  return `${dateStr} at ${formatCalendarDate(startDate, 'time')}`;
}

/**
 * Whether `timeZone` is an IANA zone Intl can format in. Tags are untrusted
 * input; an unknown zone makes Intl throw a RangeError.
 * @param {unknown} timeZone
 * @returns {timeZone is string}
 */
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const pad2 = (/** @type {number} */ n) => String(n).padStart(2, '0');

/**
 * Wall-clock fields of an instant in `timeZone` (a valid zone), as the ms of
 * the same fields read as UTC — the difference to `ms` is the zone offset.
 * @param {number} ms
 * @param {string} timeZone
 */
function wallClockAsUtcMs(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(ms));
  const get = (/** @type {string} */ type) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second')
  );
}

/**
 * The `YYYY-MM-DD` day and `HH:MM` time a timed event's form shows for a
 * stored instant: the wall-clock time in the event's zone (NIP-52
 * start_tzid/end_tzid), or the editor's own zone when that is missing or
 * invalid.
 *
 * @param {number} seconds - Unix timestamp
 * @param {string | undefined | null} timeZone
 * @returns {{ date: string, time: string }}
 */
export function zonedWallClock(seconds, timeZone) {
  const ms = seconds * 1000;
  const d = isValidTimeZone(timeZone)
    ? new Date(wallClockAsUtcMs(ms, timeZone))
    : new Date(Date.UTC(...localFields(new Date(ms))));
  return {
    date: d.toISOString().slice(0, 10),
    time: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
  };
}

/** @param {Date} d @returns {[number, number, number, number, number]} */
function localFields(d) {
  return [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()];
}

/**
 * Unix timestamp of a form's `YYYY-MM-DD` + `HH:MM` read as wall-clock time
 * in `timeZone` (the editor's own zone when missing or invalid). Like a local
 * `Date`, a time skipped by a DST change moves forward by the gap and a
 * repeated time takes its first occurrence. NaN for an incomplete value.
 *
 * @param {string} date
 * @param {string} time
 * @param {string | undefined | null} timeZone
 * @returns {number}
 */
export function wallClockToTimestamp(date, time, timeZone) {
  if (!date || !time) return NaN;
  if (!isValidTimeZone(timeZone)) {
    const ms = new Date(`${date}T${time}`).getTime();
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : NaN;
  }
  const wall = Date.parse(`${date}T${time}Z`);
  if (!Number.isFinite(wall)) return NaN;
  // A zone changes its offset at most once within a day either side: try
  // the offsets before and after, keep those that give back this wall clock.
  const offsetAt = (/** @type {number} */ ms) => wallClockAsUtcMs(ms, timeZone) - ms;
  const before = wall - offsetAt(wall - DAY_MS);
  const after = wall - offsetAt(wall + DAY_MS);
  const fits = [before, after].filter((ms) => wallClockAsUtcMs(ms, timeZone) === wall);
  // Gap (no fit): the offset before the change pushes the time forward.
  const ms = fits.length ? Math.min(...fits) : before;
  return Math.floor(ms / 1000);
}

const DAY_MS = 86_400_000;

/**
 * Date and time of a timed event's start or end, in the event's own zone
 * (NIP-52 start_tzid/end_tzid), so the printed time matches the zone label.
 * When the viewer's wall-clock time differs, `local` carries it (with the
 * viewer's date only when that is another day; `label` joins the parts). Without a valid event zone
 * the time is the viewer's, unlabelled.
 *
 * @param {Date} date
 * @param {string | undefined} eventTimeZone
 * @param {{ viewerTimeZone?: string }} [options]
 * @returns {{ date: string, time: string, zone: string,
 *   local: { date: string | null, time: string, zone: string, label: string } | null }}
 */
export function formatZonedDateTime(
  date,
  eventTimeZone,
  { viewerTimeZone = getCurrentTimezone() } = {}
) {
  const viewer = isValidTimeZone(viewerTimeZone) ? { timeZone: viewerTimeZone } : {};
  const localDate = formatCalendarDate(date, 'long', viewer);
  const localTime = formatCalendarDate(date, 'time', viewer);
  if (!isValidTimeZone(eventTimeZone)) {
    return { date: localDate, time: localTime, zone: '', local: null };
  }
  const zoned = { timeZone: eventTimeZone };
  const eventDate = formatCalendarDate(date, 'long', zoned);
  const eventTime = formatCalendarDate(date, 'time', zoned);
  const sameWallClock = eventDate === localDate && eventTime === localTime;
  return {
    date: eventDate,
    time: eventTime,
    zone: eventTimeZone,
    local: sameWallClock ? null : localPart()
  };

  function localPart() {
    const day = eventDate === localDate ? null : formatCalendarDate(date, 'short', viewer);
    const label = `${day ? `${day}, ` : ''}${localTime} ${viewerTimeZone}`;
    return { date: day, time: localTime, zone: viewerTimeZone, label };
  }
}

/**
 * Group events by date for calendar display
 * Only includes valid events that pass NIP-52 validation
 * @param {CalendarEvent[]} events - Array of calendar events
 * @returns {Map<string, CalendarEvent[]>} Map of date strings to event arrays
 */
export function groupEventsByDate(events) {
  // Defensive check for undefined/null or invalid input
  if (!events || !Array.isArray(events)) {
    console.warn('📅 groupEventsByDate: Invalid events array:', events);
    return new Map();
  }

  const groupedEvents = new Map();

  events.forEach((event) => {
    // Validate event against NIP-52 specifications
    // This ensures only valid events are displayed in the calendar
    // if (!validateCalendarEvent(event.originalEvent || event)) {
    // 	return; // Skip invalid events
    // }

    if (!event.start) return;

    // Validate that start is a valid number
    const startTimestamp =
      typeof event.start === 'number' ? event.start : parseCalendarTimestamp(String(event.start));
    if (!startTimestamp) {
      console.warn(
        '📅 groupEventsByDate: Invalid event start timestamp:',
        event.start,
        'for event:',
        event.title || event.id
      );
      return;
    }

    // Multi-day events appear on EVERY day they cover, not just the start day.
    const { startDay, endDay } = getEventDaySpan(event, startTimestamp);

    for (let day = startDay; day <= endDay; day++) {
      // day already encodes the right frame per event kind (UTC calendar day
      // for 31922, the viewer's calendar day for 31923 — see
      // dayIndexForKind), so turn it straight into its ISO date. Routing it
      // through createDateKey's local-getter conversion here would
      // reinterpret that day index a second time and shift it again by the
      // viewer's offset (edufeed-app follow-up: calendar grid placed
      // all-day events a day early for viewers west of UTC, and timed
      // events on the wrong day entirely).
      const dateKey = new Date(day * DAY_SECONDS * 1000).toISOString().slice(0, 10);
      if (!groupedEvents.has(dateKey)) {
        groupedEvents.set(dateKey, []);
      }
      groupedEvents.get(dateKey).push(event);
    }
  });

  // Sort events within each date by start timestamp
  groupedEvents.forEach((dayEvents) => {
    dayEvents.sort(
      /** @param {CalendarEvent} a @param {CalendarEvent} b */
      (a, b) => (a.start || 0) - (b.start || 0)
    );
  });

  return groupedEvents;
}

/**
 * Validate event form data
 * @param {EventFormData} formData - Form data to validate
 * @returns {string[]} Array of validation error messages
 */
export function validateEventForm(formData) {
  const errors = [];

  if (!formData.title?.trim()) {
    errors.push(m.event_modal_error_title_required());
  }

  if (!formData.startDate) {
    errors.push(m.event_modal_error_start_date_required());
  }

  if (formData.eventType === 'time' && !formData.startTime) {
    errors.push(m.event_modal_error_start_time_required());
  }

  if (formData.endDate && formData.startDate) {
    const startDate = new Date(formData.startDate);
    const endDate = new Date(formData.endDate);
    if (endDate < startDate) {
      errors.push(m.event_modal_error_end_date_before_start());
    }
  }

  if (formData.eventType === 'time' && formData.endTime && formData.startTime) {
    const startTime = new Date(`2000-01-01T${formData.startTime}`);
    const endTime = new Date(`2000-01-01T${formData.endTime}`);
    if (endTime <= startTime && formData.startDate === formData.endDate) {
      errors.push(m.event_modal_error_end_time_before_start());
    }
  }

  return errors;
}

/**
 * The exact `start`/`end`/`start_tzid`/`end_tzid` tags of a raw NIP-52 event,
 * undefaulted (unlike `getCalendarEventMetadata`, which falls `endTimezone`
 * back to `startTimezone`) — used to tell a true no-op edit from a changed
 * one. `null` for a non-timed (31922) or tagless event.
 *
 * @param {any} [rawEvent]
 * @returns {{ start: number | undefined, end: number | undefined,
 *   startTimezone: string | undefined, endTimezone: string | undefined } | null}
 */
function readStoredTimedFields(rawEvent) {
  if (!rawEvent?.tags || rawEvent.kind !== 31923) return null;
  const tagValue = (/** @type {string} */ name) =>
    rawEvent.tags.find((/** @type {string[]} */ t) => t[0] === name)?.[1];
  const start = Number(tagValue('start'));
  const endRaw = tagValue('end');
  return {
    start: Number.isFinite(start) ? start : undefined,
    end: endRaw !== undefined ? Number(endRaw) : undefined,
    startTimezone: tagValue('start_tzid') || undefined,
    endTimezone: tagValue('end_tzid') || undefined
  };
}

/**
 * Whether a form's date/time still shows the same wall-clock values the
 * stored instant would show in `zone` — i.e. the field was never touched.
 *
 * @param {string} date @param {string} time @param {string | undefined} zone
 * @param {number | undefined} storedSeconds
 * @returns {boolean}
 */
function formStillShows(date, time, zone, storedSeconds) {
  if (storedSeconds === undefined) return false;
  const shown = zonedWallClock(storedSeconds, zone);
  return shown.date === date && shown.time === time;
}

/**
 * Convert form data to calendar event object
 * @param {EventFormData} formData - Form data to convert
 * @param {string} communityPubkey - Target community public key
 * @param {any} [originalEvent] - The raw event being edited, if any. A no-op
 *   edit — date, time and zone all still showing what `originalEvent` stored —
 *   keeps the stored instant exactly (including seconds, which the HH:MM form
 *   cannot otherwise represent) and leaves a zone-less event zone-less,
 *   instead of adopting the editor's zone. Only a field the user actually
 *   changed is read in the shown zone and may gain a zone tag.
 * @returns {Partial<CalendarEvent>} Partial calendar event object
 */
export function convertFormDataToEvent(formData, communityPubkey, originalEvent) {
  /** @type {Partial<CalendarEvent>} */
  const event = {
    title: formData.title.trim(),
    summary: formData.summary?.trim() || '',
    image: formData.image?.trim() || '',
    communityPubkey,
    location: formData.location?.trim() || '',
    hashtags: normalizeHashtags(formData.hashtags),
    references: formData.references || [],
    participants: []
  };

  // Handle date/time conversion
  if (formData.eventType === 'date' || formData.isAllDay) {
    // Date-based event (kind 31922)
    event.kind = 31922;
    const startDate = new Date(formData.startDate);
    event.start = Math.floor(startDate.getTime() / 1000);

    if (formData.endDate) {
      const endDate = new Date(formData.endDate);
      event.end = Math.floor(endDate.getTime() / 1000);
    }
  } else {
    // Time-based event (kind 31923)
    event.kind = 31923;
    const stored = readStoredTimedFields(originalEvent);

    // The form shows wall-clock times in the event's zones (start_tzid /
    // end_tzid), so read them back in those zones, not the editor's — unless
    // nothing changed, in which case keep the stored instant exactly.
    const startUnchanged = formStillShows(
      formData.startDate,
      formData.startTime,
      formData.startTimezone,
      stored?.start
    );
    event.start = startUnchanged
      ? /** @type {number} */ (stored?.start)
      : wallClockToTimestamp(formData.startDate, formData.startTime, formData.startTimezone);

    const hasEnd = Boolean(formData.endDate && formData.endTime);
    const endZone = formData.endTimezone || formData.startTimezone;
    const endUnchanged =
      hasEnd && formStillShows(formData.endDate, formData.endTime, endZone, stored?.end);

    if (hasEnd) {
      event.end = endUnchanged
        ? /** @type {number} */ (stored?.end)
        : wallClockToTimestamp(formData.endDate, formData.endTime, endZone);
    }

    // Timezone tags: a no-op field keeps the original's zone presence
    // exactly (including staying zone-less) — only a field the user actually
    // changed adopts the shown zone.
    if (startUnchanged) {
      if (stored?.startTimezone) event.startTimezone = stored.startTimezone;
    } else if (formData.startTimezone) {
      event.startTimezone = formData.startTimezone;
    }

    if (hasEnd) {
      if (endUnchanged) {
        if (stored?.endTimezone) event.endTimezone = stored.endTimezone;
      } else if (formData.endTimezone) {
        event.endTimezone = formData.endTimezone;
      }
    }
  }

  return event;
}

/**
 * Get current user's timezone
 * @returns {string} IANA timezone identifier
 */
export function getCurrentTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Check if a date is today
 * @param {Date} date - Date to check
 * @returns {boolean} True if date is today
 */
export function isToday(date) {
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

/**
 * Check if a date is in the current month
 * @param {Date} date - Date to check
 * @param {Date} referenceDate - Reference date for current month
 * @returns {boolean} True if date is in the same month as reference
 */
export function isCurrentMonth(date, referenceDate) {
  return (
    date.getMonth() === referenceDate.getMonth() &&
    date.getFullYear() === referenceDate.getFullYear()
  );
}

/**
 * Get the next occurrence of a weekday
 * @param {number} weekday - Day of week (0 = Sunday, 6 = Saturday)
 * @param {Date} [fromDate] - Starting date (defaults to today)
 * @returns {Date} Next occurrence of the weekday
 */
export function getNextWeekday(weekday, fromDate = new Date()) {
  const date = new Date(fromDate);
  const currentDay = date.getDay();
  const daysUntilTarget = (weekday - currentDay + 7) % 7;

  if (daysUntilTarget === 0) {
    // If it's the same weekday, get next week's occurrence
    date.setDate(date.getDate() + 7);
  } else {
    date.setDate(date.getDate() + daysUntilTarget);
  }

  return date;
}

/**
 * Create a UTC-based date key for consistent event grouping and lookup
 * @param {Date} date - Local date object
 * @returns {string} UTC date key in YYYY-MM-DD format
 */
export function createDateKey(date) {
  // Validate the date is valid
  if (!date || isNaN(date.getTime())) {
    console.warn('📅 createDateKey: Invalid date passed:', date);
    // Return today's date as fallback
    const today = new Date();
    const utcDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    return utcDate.toISOString().split('T')[0];
  }

  // Convert local date to UTC date for consistent key generation
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  return utcDate.toISOString().split('T')[0];
}

/**
 * Get weekday headers based on the configured week start day
 * @returns {string[]} Array of weekday abbreviations starting from configured day
 */
export function getWeekdayHeaders() {
  const weekStartDay = runtimeConfig.calendar.weekStartDay;
  // Short names in the app locale (they were hard-coded English — QA round 3
  // K5): 4 Jan 2026 is a Sunday. German's trailing dot ("Mo.") is dropped.
  const format = new Intl.DateTimeFormat(activeDateLocale(), { weekday: 'short', timeZone: 'UTC' });
  const fullWeekdays = Array.from({ length: 7 }, (_, i) =>
    format.format(new Date(Date.UTC(2026, 0, 4 + i))).replace(/\.$/, '')
  );

  // Rotate the array to start from the configured day
  const rotatedWeekdays = [
    ...fullWeekdays.slice(weekStartDay),
    ...fullWeekdays.slice(0, weekStartDay)
  ];

  return rotatedWeekdays;
}

/**
 * Filter events based on view mode and current date
 * @param {CalendarEvent[]} events - Array of calendar events
 * @param {'all' | 'day' | 'week' | 'month'} viewMode - Current view mode
 * @param {Date} currentDate - Current reference date
 * @returns {CalendarEvent[]} Filtered and sorted events
 */
export function filterEventsByViewMode(events, viewMode, currentDate) {
  // If viewMode is 'all', return all events sorted
  if (viewMode === 'all') {
    // Sort by start date/time (chronological order) - create copy before sorting
    return [...events].sort((a, b) => (a.start || 0) - (b.start || 0));
  }

  if (!currentDate) return events;

  // For day view, use the same date-key approach as CalendarGrid for timezone consistency
  if (viewMode === 'day') {
    const groupedEvents = groupEventsByDate(events);
    const dateKey = createDateKey(currentDate);
    const dayEvents = groupedEvents.get(dateKey) || [];
    // Already sorted by groupEventsByDate
    return dayEvents;
  }

  // Day-index range for the view (for week/month), in the same frame
  // getEventDaySpan uses per kind. An event is "in view" when its day span
  // overlaps the view's days — not when its raw instant falls inside a
  // window built by reinterpreting the view's local days as UTC instants
  // (isEventInDateRange's old approach here), which silently dropped or
  // misplaced timed events near local midnight for viewers off UTC.
  let viewDates;
  switch (viewMode) {
    case 'week':
      viewDates = getWeekDates(currentDate);
      break;
    case 'month':
      viewDates = getMonthDates(currentDate);
      break;
    default:
      return events;
  }
  const viewStartDay = calendarDayIndex(viewDates[0]);
  const viewEndDay = calendarDayIndex(viewDates[viewDates.length - 1]);

  // Filter events whose day span overlaps the view's day range
  const filtered = events.filter((event) => {
    const { startDay, endDay } = getEventDaySpan(event);
    return startDay <= viewEndDay && endDay >= viewStartDay;
  });

  // Sort by start date/time (chronological order) - filtered array is already a new array from .filter()
  return filtered.sort((a, b) => (a.start || 0) - (b.start || 0));
}

/**
 * Narrow a list of events to those whose underlying raw NostrEvent was seen
 * on at least one of the user-selected relays.
 *
 * Items may be CalendarEvent wrappers (with `.originalEvent`) or raw events —
 * applesauce stores seen-relay metadata via a Symbol on the raw event, so we
 * unwrap before calling getSeenRelays. Both sides are normalized so that
 * casing / trailing-slash differences between the UI selection and the
 * applesauce-stored URL don't cause false negatives.
 *
 * @template T
 * @param {T[]} events
 * @param {string[]} selectedRelays
 * @returns {T[]}
 */
export function filterEventsBySelectedRelays(events, selectedRelays) {
  if (!selectedRelays || selectedRelays.length === 0) return events;
  const normSet = new Set(selectedRelays.map((r) => normalizeURL(r)));
  return events.filter((e) => {
    const raw = /** @type {any} */ (e)?.originalEvent ?? e;
    const seen = getSeenRelays(/** @type {any} */ (raw));
    if (!seen) return false;
    for (const r of seen) if (normSet.has(normalizeURL(r))) return true;
    return false;
  });
}

/**
 * Detect calendar identifier type
 * @param {string} identifier - Calendar identifier (naddr, npub, or hex pubkey)
 * @returns {'naddr' | 'pubkey' | 'unknown'} Identifier type
 */
export function detectCalendarIdentifierType(identifier) {
  if (!identifier || typeof identifier !== 'string') {
    return 'unknown';
  }

  // Check if it's an naddr
  if (identifier.startsWith('naddr1')) {
    return 'naddr';
  }

  // Check if it's an npub or hex pubkey (64 hex chars)
  if (identifier.startsWith('npub1') || /^[0-9a-f]{64}$/i.test(identifier)) {
    return 'pubkey';
  }

  return 'unknown';
}

/**
 * Fetch all calendar events for a community
 * Consolidates events from both direct (#h tagged) and targeted publications (#p tagged)
 * @param {string} communityPubkey - Community public key
 * @param {string[]} [relays] - Optional relay URLs to query
 * @returns {Promise<import('nostr-tools').NostrEvent[]>} Array of calendar events
 */
export async function fetchCommunityCalendarEvents(communityPubkey, relays = []) {
  const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');
  const { communityCalendarTimelineLoader, communityTargetedPublicationsLoader, addressLoader } =
    await import('$lib/loaders');
  const { getTagValue } = await import('applesauce-core/helpers');
  const { bufferTime, mergeMap, firstValueFrom } = await import('rxjs');

  /** @type {import('nostr-tools').NostrEvent[]} */
  const allEvents = [];
  /** @type {Set<string>} */
  const eventIds = new Set(); // For deduplication

  try {
    // Fetch direct community calendar events (#h tagged)
    // Use bufferTime to wait for events from multiple relays (3 seconds)
    const directTimeline$ = communityCalendarTimelineLoader(communityPubkey);
    /** @type {import('nostr-tools').NostrEvent[]} */
    const directEventsBuffered = await firstValueFrom(
      directTimeline$.pipe(
        bufferTime(3000), // Wait 3 seconds to collect events from relays
        mergeMap((bufferedArrays) => {
          // Flatten the array of arrays into a single array
          const flattened = bufferedArrays.flat();
          return [flattened];
        })
      ),
      { defaultValue: [] }
    );

    // Flatten and deduplicate direct events
    /** @type {import('nostr-tools').NostrEvent[]} */
    const directEventsArray = Array.isArray(directEventsBuffered)
      ? directEventsBuffered.flat()
      : [];

    for (const event of directEventsArray) {
      if (!eventIds.has(event.id)) {
        eventIds.add(event.id);
        allEvents.push(event);
      }
    }

    // Fetch targeted publication events (#p tagged with #k for calendar)
    // Use bufferTime to wait for events from multiple relays (3 seconds)
    const targetedPubTimeline$ = communityTargetedPublicationsLoader(
      communityPubkey,
      [31922, 31923]
    );
    /** @type {import('nostr-tools').NostrEvent[]} */
    const targetedPubsBuffered = await firstValueFrom(
      targetedPubTimeline$.pipe(
        bufferTime(3000), // Wait 3 seconds to collect events from relays
        mergeMap((bufferedArrays) => {
          // Flatten the array of arrays into a single array
          const flattened = bufferedArrays.flat();
          return [flattened];
        })
      ),
      { defaultValue: [] }
    );

    // Flatten and deduplicate targeted publications
    /** @type {import('nostr-tools').NostrEvent[]} */
    const targetedPubsArray = Array.isArray(targetedPubsBuffered)
      ? targetedPubsBuffered.flat()
      : [];

    // Resolve referenced events from targeted publications
    // Now using addressable references ('a' tags) instead of event IDs ('e' tags)
    const referencedEventPromises = [];

    for (const pubEvent of targetedPubsArray) {
      try {
        // Look for 'a' tag (addressable reference) instead of 'e' tag (event ID)
        const aTag = getTagValue(pubEvent, 'a');
        if (!aTag) {
          // Fallback to 'e' tag for backward compatibility with old shares
          const eTag = getTagValue(pubEvent, 'e');
          if (!eTag) continue;

          console.warn(
            `📅 fetchCommunityCalendarEvents: Found old-style share with 'e' tag: ${eTag}`
          );
          // Handle old-style event ID reference (will be deprecated)
          if (eventIds.has(eTag)) continue;

          let referencedEvent = eventStore.getEvent(eTag);
          if (referencedEvent && !eventIds.has(referencedEvent.id)) {
            eventIds.add(referencedEvent.id);
            allEvents.push(referencedEvent);
          }
          continue;
        }

        // Parse address: kind:pubkey:dtag - the d-tag itself may contain
        // colons (e.g. a URL), so only the first two colons are delimiters;
        // everything after them is rejoined into the d-tag verbatim.
        const parts = aTag.split(':');
        if (parts.length < 3) {
          console.warn(`📅 fetchCommunityCalendarEvents: Invalid address format: ${aTag}`);
          continue;
        }

        const [kindStr, pubkey, ...dTagParts] = parts;
        const dTag = dTagParts.join(':');
        const kind = parseInt(kindStr);

        // Validate it's a calendar event kind
        if (kind !== 31922 && kind !== 31923) {
          console.warn(`📅 fetchCommunityCalendarEvents: Invalid calendar event kind: ${kind}`);
          continue;
        }

        // Try to get from event store first using address
        const existingEvent = eventStore.replaceable({ kind, pubkey, identifier: dTag });

        // If we have it in store, use it immediately
        if (existingEvent && typeof existingEvent === 'object' && 'id' in existingEvent) {
          const /** @type {any} */ cachedEvent = existingEvent;
          if (!eventIds.has(cachedEvent.id)) {
            eventIds.add(cachedEvent.id);
            allEvents.push(cachedEvent);
          }
        } else {
          // If not in store, create a promise to load it by address
          /** @type {string[]} */
          let relayList = relays;
          // Use default relays as fallback if no relays provided
          if (relayList.length === 0) {
            relayList = [
              ...(runtimeConfig.appRelays?.calendar || []),
              ...(runtimeConfig.fallbackRelays || [])
            ];
          }

          const loadPromise = firstValueFrom(
            addressLoader({ kind, pubkey, identifier: dTag, relays: relayList }).pipe(
              bufferTime(2000)
            ),
            { defaultValue: null }
          )
            .then((bufferedEvents) => {
              if (bufferedEvents && Array.isArray(bufferedEvents)) {
                const loadedEvent = bufferedEvents.find((e) => e && e.kind === kind);
                if (loadedEvent && !eventIds.has(loadedEvent.id)) {
                  eventIds.add(loadedEvent.id);
                  allEvents.push(loadedEvent);
                }
              } else if (
                bufferedEvents &&
                typeof bufferedEvents === 'object' &&
                'id' in bufferedEvents
              ) {
                // Single event returned
                const /** @type {any} */ singleEvent = bufferedEvents;
                if (!eventIds.has(singleEvent.id)) {
                  eventIds.add(singleEvent.id);
                  allEvents.push(singleEvent);
                }
              }
            })
            .catch((err) => {
              console.warn(
                `📅 fetchCommunityCalendarEvents: Failed to load referenced event ${aTag}:`,
                err
              );
            });

          referencedEventPromises.push(loadPromise);
        }
      } catch (err) {
        console.warn(
          `📅 fetchCommunityCalendarEvents: Failed to resolve targeted publication ${pubEvent.id}:`,
          err
        );
      }
    }

    // Wait for all referenced events to be resolved
    await Promise.all(referencedEventPromises);

    return allEvents;
  } catch (error) {
    console.error(
      '📅 fetchCommunityCalendarEvents: Error fetching community calendar events:',
      error
    );
    return [];
  }
}

/**
 * Build NIP-52 compliant tags for a calendar event.
 * Pure function — no signing, no publishing, no stores.
 *
 * @param {EventFormData} formData - Raw form data (startDate as "YYYY-MM-DD")
 * @param {Partial<CalendarEvent>} eventData - Converted event data from convertFormDataToEvent
 * @param {string} dTag - The d-tag identifier
 * @param {string | string[]} [hTag] - Optional community h-tag(s)
 * @returns {string[][]} Array of NIP-52 compliant tags
 */
export function buildCalendarEventTags(formData, eventData, dTag, hTag) {
  /** @type {string[][]} */
  const tags = [];

  // d-tag (addressable/replaceable event identifier)
  tags.push(['d', dTag]);

  // h-tag(s) for community targeting (Communikey spec)
  if (hTag) {
    const hTags = Array.isArray(hTag) ? hTag : [hTag];
    for (const h of hTags) {
      if (h) tags.push(['h', h]);
    }
  }

  // Title
  tags.push(['title', eventData.title || '']);

  // Start/end tags — format depends on event kind
  if (eventData.kind === 31922) {
    // Kind 31922 (date-based): NIP-52 requires ISO 8601 date strings. The
    // form's end date is the inclusive last day; NIP-52's `end` is exclusive.
    tags.push(['start', formData.startDate]);
    const end = allDayEndTagValue(formData.startDate, formData.endDate);
    if (end) {
      tags.push(['end', end]);
    }
  } else {
    // Kind 31923 (time-based): Unix timestamp strings
    if (eventData.start) {
      tags.push(['start', eventData.start.toString()]);
    }
    if (eventData.end) {
      tags.push(['end', eventData.end.toString()]);
    }
  }

  // Timezone tags — only for kind 31923, using NIP-52 compliant names
  if (eventData.kind === 31923) {
    if (eventData.startTimezone) {
      tags.push(['start_tzid', eventData.startTimezone]);
    }
    // end_tzid only means anything alongside an end — writing it without one
    // (e.g. a stale formData.endTimezone when the end was removed) would
    // contradict NIP-52's "omitted end_tzid is start_tzid's zone" rule.
    if (eventData.endTimezone && eventData.end) {
      tags.push(['end_tzid', eventData.endTimezone]);
    }
  }

  // D tags (day-granularity) — only for kind 31923. `end` is exclusive
  // (NIP-52), so an end landing exactly on midnight must not pull in the
  // next day — subtract a second before flooring to the day index.
  if (eventData.kind === 31923 && eventData.start) {
    const startDay = Math.floor(eventData.start / 86400);
    const endDay =
      eventData.end && eventData.end > eventData.start
        ? Math.floor((eventData.end - 1) / 86400)
        : startDay;
    for (let day = startDay; day <= endDay; day++) {
      tags.push(['D', day.toString()]);
    }
  }

  // Optional properties
  if (eventData.image) {
    tags.push(['image', eventData.image]);
  }
  if (eventData.location) {
    tags.push(['location', eventData.location]);
  }

  // Hashtags
  if (eventData.hashtags) {
    eventData.hashtags.forEach((hashtag) => {
      if (hashtag) tags.push(['t', hashtag]);
    });
  }

  // References
  if (eventData.references) {
    eventData.references.forEach((reference) => {
      if (reference) tags.push(['r', reference]);
    });
  }

  // Geohash
  if (eventData.geohash) {
    tags.push(['g', eventData.geohash]);
  }

  // Participants (NIP-52): ["p", pubkey, relay hint, role]
  // Named participants without an npub (most real-world speakers) use the
  // app-specific ["participant", name, "", role] tag with the same slot
  // layout, so parsing in getCalendarEventMetadata stays symmetric.
  if (formData.participants) {
    for (const participant of formData.participants) {
      if (participant?.pubkey) {
        if (participant.role) {
          tags.push(['p', participant.pubkey, participant.relay || '', participant.role]);
        } else if (participant.relay) {
          tags.push(['p', participant.pubkey, participant.relay]);
        } else {
          tags.push(['p', participant.pubkey]);
        }
        continue;
      }
      const name = participant?.name?.trim();
      if (!name) continue;
      if (participant.role) {
        tags.push(['participant', name, '', participant.role]);
      } else {
        tags.push(['participant', name]);
      }
    }
  }

  // Educational extension attributes (NIP-52-Edufeed, issue #13)
  tags.push(...buildCalendarEventAttributeTags(formData.attributes));

  return tags;
}

/**
 * Tag names the calendar event form manages — everything `buildCalendarEventTags`
 * (plus the attribute builder) can emit and the form round-trips. On edit these
 * are replaced wholesale by the form's output; any other tag on the existing
 * event is kept. A trailing `*` marks a name prefix.
 *
 * Not listed on purpose: `summary` (NIP-52 short description — the form edits
 * `content`, not this tag), `a`, `L`/`l` and `g` (`convertFormDataToEvent` never
 * sets a geohash, so the builder never writes one on edit). `client` is listed
 * because the event factory owns it: it re-adds it when the user opted in and
 * an edit by this app must not keep another client's attribution. `name` is
 * listed even though the form never emits it: it's NIP-52's deprecated
 * precursor to `title`, so an edit that writes `title` must drop a stale
 * `name` rather than carry it along forever.
 * @type {readonly string[]}
 */
export const CALENDAR_FORM_OWNED_TAGS = Object.freeze([
  'd',
  'h',
  'title',
  'name',
  'start',
  'end',
  'start_tzid',
  'end_tzid',
  'D',
  'image',
  'location',
  't',
  'r',
  'p',
  'participant',
  'registrationRequired',
  'price',
  'eventAttendanceMode',
  'educationalLevel:*',
  'client'
]);

/**
 * Merge a form's freshly built tags into an existing event's tags: tags whose
 * name the form owns are dropped from the existing event and replaced by the
 * form's tags; every other existing tag is kept, in its original order, after
 * the form's tags. Any name the form actually emitted counts as owned too, so
 * the result never carries a stale duplicate.
 *
 * Pure function.
 *
 * @param {string[][]} existingTags - Tags of the event being edited (untrusted)
 * @param {string[][]} formTags - Tags built from the form
 * @param {Iterable<string>} ownedNames - Owned tag names; `prefix*` matches by prefix
 * @returns {string[][]}
 */
export function mergeFormOwnedTags(existingTags, formTags, ownedNames) {
  const exact = new Set(formTags.map((t) => t[0]));
  /** @type {string[]} */
  const prefixes = [];
  for (const name of ownedNames) {
    if (name.endsWith('*')) prefixes.push(name.slice(0, -1));
    else exact.add(name);
  }

  /** @param {string} name */
  const isOwned = (name) => exact.has(name) || prefixes.some((p) => name.startsWith(p));

  const kept = (Array.isArray(existingTags) ? existingTags : [])
    .filter((t) => Array.isArray(t) && typeof t[0] === 'string' && !isOwned(t[0]))
    .map((t) => [...t]);

  return [...formTags, ...kept];
}

/**
 * Padding in days to add before/after the view range to catch multi-day events
 * that span view boundaries
 * @type {number}
 */
export const VIEW_RANGE_PADDING_DAYS = 7;

/**
 * Check if a raw Nostr event falls within a date range
 * This works with raw events from relay (not CalendarEvent objects).
 * Extracts start/end timestamps from event tags.
 *
 * @param {import('nostr-tools').NostrEvent} event - Raw Nostr event
 * @param {number} rangeStart - Start of range as Unix timestamp (seconds)
 * @param {number} rangeEnd - End of range as Unix timestamp (seconds)
 * @returns {boolean} True if event overlaps with date range
 */
export function isRawEventInDateRange(event, rangeStart, rangeEnd) {
  if (!event || !event.tags) return false;

  // Extract start timestamp from tags (handles both date strings and Unix timestamps)
  const startTag = event.tags.find((/** @type {string[]} */ tag) => tag[0] === 'start');
  if (!startTag || !startTag[1]) return false;

  const eventStart = parseCalendarTimestamp(startTag[1], event.kind);
  if (!eventStart) return false;

  // Extract end timestamp from tags (optional; a 31922 end is exclusive)
  const endTag = event.tags.find((/** @type {string[]} */ tag) => tag[0] === 'end');
  const eventEnd = calendarEventEnd(endTag?.[1], eventStart, event.kind) || eventStart;

  // Check for overlap: eventStart < rangeEnd AND eventEnd >= rangeStart
  return eventStart < rangeEnd && eventEnd >= rangeStart;
}

/**
 * Check if an event's start time is after a given timestamp
 * Used for client-side filtering when paginating calendar events by start time.
 *
 * @param {import('nostr-tools').NostrEvent} event - Raw Nostr event
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {boolean} True if event start is after the timestamp
 */
export function isEventStartAfter(event, timestamp) {
  if (!event || !event.tags) return false;
  const startTag = event.tags.find((/** @type {string[]} */ tag) => tag[0] === 'start');
  const eventStart = startTag ? parseCalendarTimestamp(startTag[1], event.kind) : 0;
  return eventStart > timestamp;
}

/**
 * Get the start timestamp from an event
 * @param {import('nostr-tools').NostrEvent} event - Raw Nostr event
 * @returns {number} The start timestamp, or 0 if not found
 */
export function getEventStartTimestamp(event) {
  if (!event || !event.tags) return 0;
  const startTag = event.tags.find((/** @type {string[]} */ tag) => tag[0] === 'start');
  return startTag ? parseCalendarTimestamp(startTag[1], event.kind) : 0;
}

/**
 * Get the end timestamp from an event — for kind 31922 the midnight of the
 * last day (NIP-52's `end` tag is exclusive), see `calendarEventEnd`.
 * @param {import('nostr-tools').NostrEvent} event - Raw Nostr event
 * @returns {number} The end timestamp, or 0 if not found
 */
export function getEventEndTimestamp(event) {
  if (!event || !event.tags) return 0;
  const endTag = event.tags.find((/** @type {string[]} */ tag) => tag[0] === 'end');
  return endTag ? calendarEventEnd(endTag[1], getEventStartTimestamp(event), event.kind) : 0;
}

/**
 * Check if a calendar event overlaps with a date range
 * Works with CalendarEvent objects (processed events with start/end properties).
 * An event overlaps if it starts before range end AND ends after range start.
 *
 * @param {{start?: number, end?: number}} event - Calendar event with start/end properties (Unix seconds)
 * @param {number} rangeStart - Range start timestamp (Unix seconds)
 * @param {number} rangeEnd - Range end timestamp (Unix seconds)
 * @returns {boolean} True if event overlaps with the date range
 */
export function eventOverlapsDateRange(event, rangeStart, rangeEnd) {
  const eventStart = event.start || 0;
  const eventEnd = event.end || eventStart;
  // Event overlaps if it starts before range end AND ends after range start
  return eventStart <= rangeEnd && eventEnd >= rangeStart;
}

/**
 * Get the date range for a given view (with padding for multi-day events)
 * Returns Unix timestamps suitable for relay queries.
 *
 * The padding catches multi-day events that:
 * - Start before the view but extend into it
 * - Start in the view but extend past it
 *
 * @param {Date} currentDate - The current viewing date
 * @param {'month' | 'week' | 'day'} viewMode - The view mode
 * @returns {{ start: number, end: number }} Unix timestamps (seconds)
 */
export function getViewDateRange(currentDate, viewMode) {
  let viewStart, viewEnd;

  switch (viewMode) {
    case 'day': {
      // Single day view
      viewStart = new Date(currentDate);
      viewStart.setHours(0, 0, 0, 0);
      viewEnd = new Date(currentDate);
      viewEnd.setHours(23, 59, 59, 999);
      break;
    }
    case 'week': {
      // Week view - use getWeekDates for consistency with grid display
      const weekDates = getWeekDates(currentDate);
      viewStart = new Date(weekDates[0]);
      viewStart.setHours(0, 0, 0, 0);
      viewEnd = new Date(weekDates[weekDates.length - 1]);
      viewEnd.setHours(23, 59, 59, 999);
      break;
    }
    case 'month':
    default: {
      // Month view - use getMonthDates for consistency with grid display (42 days)
      const monthDates = getMonthDates(currentDate);
      viewStart = new Date(monthDates[0]);
      viewStart.setHours(0, 0, 0, 0);
      viewEnd = new Date(monthDates[monthDates.length - 1]);
      viewEnd.setHours(23, 59, 59, 999);
      break;
    }
  }

  // Add padding to catch multi-day events spanning boundaries
  const paddingMs = VIEW_RANGE_PADDING_DAYS * 24 * 60 * 60 * 1000;
  const startWithPadding = new Date(viewStart.getTime() - paddingMs);
  const endWithPadding = new Date(viewEnd.getTime() + paddingMs);

  return {
    start: Math.floor(startWithPadding.getTime() / 1000),
    end: Math.floor(endWithPadding.getTime() / 1000)
  };
}

/**
 * Get community calendar metadata for ICS generation
 * @param {string} communityPubkey - Community public key
 * @returns {Promise<{title: string, summary: string, relays: string[]}>} Calendar metadata
 */
export async function getCommunityCalendarMetadata(communityPubkey) {
  const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');
  const { firstValueFrom } = await import('rxjs');

  try {
    // Get community profile (kind 0)
    const profile$ = eventStore.profile(communityPubkey);
    const profileEvent = await firstValueFrom(profile$, { defaultValue: null });

    let title = 'Community Calendar';
    let summary = '';

    if (profileEvent) {
      // profileEvent is already ProfileContent from eventStore.profile()
      const displayName = profileEvent?.name || profileEvent?.display_name || '';
      title = displayName ? `${displayName} Calendar` : 'Community Calendar';
      summary = profileEvent?.about || '';
    }

    // Get community definition (kind 10222) for relays
    const communityDef$ = eventStore.replaceable({ kind: 10222, pubkey: communityPubkey });
    const communityDefEvent = await firstValueFrom(communityDef$, { defaultValue: null });

    /** @type {string[]} */
    let relays = [];
    if (communityDefEvent) {
      relays = communityDefEvent.tags
        .filter(/** @param {string[]} tag */ (tag) => tag[0] === 'r')
        .map(/** @param {string[]} tag */ (tag) => tag[1]);

      // Check for description override
      const descTag = communityDefEvent.tags.find(
        /** @param {string[]} tag */ (tag) => tag[0] === 'description'
      );
      if (descTag && descTag[1]) {
        summary = descTag[1];
      }
    }

    return { title, summary, relays };
  } catch (error) {
    console.error('📅 getCommunityCalendarMetadata: Error fetching metadata:', error);
    return {
      title: 'Community Calendar',
      summary: '',
      relays: []
    };
  }
}
