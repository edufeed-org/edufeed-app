/**
 * Date logic of the calendar event dialog, kept pure so it can be tested
 * without rendering the modal. Dates are the form's `YYYY-MM-DD` strings;
 * day arithmetic runs on UTC midnights so DST changes never shift a day.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {string} iso
 * @returns {number | null} UTC midnight in ms, or null for anything but a real day
 */
function dayMs(iso) {
  if (!iso || !ISO_DAY.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  // Date.parse rolls 2026-02-31 over; only accept days that round-trip.
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== iso) return null;
  return ms;
}

/** @param {number} ms */
function isoFromMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The end date after the user moved the start date.
 *
 * - End not edited by the user: it follows the start, keeping the day
 *   offset between them (0 for a new event, which ends the day it starts).
 *   An empty end or an unknown previous start falls back to the start.
 * - End edited by the user: it stays, unless the start now lies after it —
 *   then it is pulled up to the start so the end never precedes the start.
 *   An empty end stays empty (the event simply has no end).
 * - While the new start is not a valid day (mid-typing), the end is kept.
 *
 * @param {{ previousStart: string, nextStart: string, endDate: string, endEdited: boolean }} input
 * @returns {string}
 */
export function followStartDate({ previousStart, nextStart, endDate, endEdited }) {
  const next = dayMs(nextStart);
  if (next === null) return endDate;

  const end = dayMs(endDate);

  if (!endEdited) {
    const prev = dayMs(previousStart);
    if (prev === null || end === null) return nextStart;
    const offset = Math.max(0, end - prev);
    return isoFromMs(next + offset);
  }

  if (end === null) return endDate;
  return end < next ? nextStart : endDate;
}

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const DEFAULT_DURATION = 60 * MINUTE;

/**
 * @param {string} time
 * @returns {number | null} ms since midnight, or null for anything but `HH:MM`
 */
function timeMs(time) {
  const match = HH_MM.exec(time ?? '');
  if (!match) return null;
  return (Number(match[1]) * 60 + Number(match[2])) * MINUTE;
}

/** @param {number} ms ms since some UTC midnight */
function hhmmFromMs(ms) {
  const minutes = Math.round((((ms % DAY) + DAY) % DAY) / MINUTE);
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * The end (date + time) of a timed event after the user moved the start time.
 *
 * - End time not edited by the user: it follows the start, keeping the
 *   event's duration (one hour when there is no positive previous duration).
 * - End time edited by the user: it stays, unless the new start lies at or
 *   after it — then it is pushed to the new start plus the previous duration
 *   (or one hour), so the end never precedes the start.
 * - A moved end that crosses midnight rolls the end date (and back again).
 *   An empty end date stays empty (the event has no end); while the start
 *   date is not a valid day only the time moves.
 * - While the new start time is not a valid `HH:MM` (mid-typing), the end
 *   is kept.
 *
 * @param {{
 *   startDate: string,
 *   previousStartTime: string,
 *   nextStartTime: string,
 *   endDate: string,
 *   endTime: string,
 *   endEdited: boolean
 * }} input
 * @returns {{ endDate: string, endTime: string }}
 */
export function followStartTime({
  startDate,
  previousStartTime,
  nextStartTime,
  endDate,
  endTime,
  endEdited
}) {
  const unchanged = { endDate, endTime };
  const nextTime = timeMs(nextStartTime);
  if (nextTime === null) return unchanged;

  // Without a valid start day, reason on a single anonymous day.
  const startDay = dayMs(startDate);
  const day = startDay ?? 0;
  const endDay = startDay === null ? 0 : (dayMs(endDate) ?? startDay);

  const prevTime = timeMs(previousStartTime);
  const endClock = timeMs(endTime);
  const end = endClock === null ? null : endDay + endClock;
  const prevStart = prevTime === null ? null : day + prevTime;
  const duration =
    end !== null && prevStart !== null && end > prevStart ? end - prevStart : DEFAULT_DURATION;

  const nextStart = day + nextTime;
  if (endEdited && end !== null && nextStart < end) return unchanged;

  const nextEnd = nextStart + duration;
  const nextEndDay = nextEnd - (((nextEnd % DAY) + DAY) % DAY);
  return {
    endDate: startDay === null || !endDate ? endDate : isoFromMs(nextEndDay),
    endTime: hhmmFromMs(nextEnd)
  };
}
