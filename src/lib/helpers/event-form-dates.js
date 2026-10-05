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
