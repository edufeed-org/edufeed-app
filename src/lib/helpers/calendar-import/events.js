// Turns the LLM's raw `{ events: [...] }` rows into validated ImportEvents
// with stable d-tags, so re-running an import on the same text (or the user
// re-ticking rows) never creates duplicate calendar events.
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * @typedef {Object} ImportEvent
 * @property {string} key
 * @property {string} title
 * @property {string} startDate
 * @property {string} [startTime]
 * @property {string} endDate
 * @property {string} [endTime]
 * @property {boolean} allDay
 * @property {string} [location]
 * @property {string} [description]
 * @property {number} kind
 * @property {string} [dTag]
 * @property {'date'|'title'} [problem]
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):([0-5]\d)\s*(AM|PM)?$/i;

/** @param {string} dateStr */
function isValidDate(dateStr) {
  if (!DATE_RE.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** @param {unknown} raw */
function normalizeTime(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const match = TIME_RE.exec(raw.trim());
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = match[2];
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === 'AM') {
    if (hour === 12) hour = 0;
  } else if (meridiem === 'PM') {
    if (hour !== 12) hour += 12;
  }
  if (hour > 23) return undefined;
  return `${String(hour).padStart(2, '0')}:${minute}`;
}

/**
 * @param {string} title
 * @param {string} startDate
 * @param {string | undefined} startTime
 */
function makeDTag(title, startDate, startTime) {
  const payload = `${title}\n${startDate}T${startTime ?? ''}`;
  const hash = sha256(new TextEncoder().encode(payload));
  return 'import-' + bytesToHex(hash).slice(0, 16);
}

/**
 * @param {any} row
 * @param {number} index
 * @returns {ImportEvent}
 */
function toImportEvent(row, index) {
  const rawTitle = typeof row?.title === 'string' ? row.title.trim() : '';
  const titleOk = rawTitle.length > 0;
  const title = titleOk ? rawTitle : '?';

  const startDate = typeof row?.startDate === 'string' ? row.startDate : '';
  const dateOk = isValidDate(startDate);

  const startTime = normalizeTime(row?.startTime);
  const endTime = normalizeTime(row?.endTime);
  const allDay = !!row?.allDay || !startTime;

  const endDateOk = isValidDate(row?.endDate) && row.endDate >= startDate;
  const endDate = endDateOk ? row.endDate : startDate;

  const kind = allDay ? 31922 : 31923;
  const problem = !titleOk ? 'title' : !dateOk ? 'date' : undefined;
  const dTag = problem ? undefined : makeDTag(title, startDate, startTime);
  const key = dTag ?? 'row-' + index;

  /** @type {ImportEvent} */
  const event = { key, title, startDate, endDate, allDay, kind };
  if (!allDay && startTime) event.startTime = startTime;
  if (!allDay && endTime) event.endTime = endTime;
  if (typeof row?.location === 'string' && row.location) event.location = row.location;
  if (typeof row?.description === 'string' && row.description) event.description = row.description;
  if (dTag) event.dTag = dTag;
  if (problem) event.problem = problem;
  return event;
}

/**
 * @param {unknown} raw server response shaped `{ events: [...] }`
 * @param {{ tz?: string }} [_options] reserved for timezone-aware normalisation
 * @returns {ImportEvent[]}
 */
export function toImportEvents(raw, _options = {}) {
  /** @type {any[]} */
  const rows = Array.isArray(/** @type {any} */ (raw)?.events)
    ? /** @type {any} */ (raw).events
    : [];

  // Same title+start twice (a re-run on the same text, or the LLM echoing a
  // row) would otherwise produce two events with the same dTag — and the
  // same `key`, which crashes a keyed {#each}. Keep only the first.
  /** @type {Set<string>} */
  const seenDTags = new Set();
  /** @type {ImportEvent[]} */
  const events = [];
  rows.forEach((row, index) => {
    const event = toImportEvent(row, index);
    if (event.dTag) {
      if (seenDTags.has(event.dTag)) return;
      seenDTags.add(event.dTag);
    }
    events.push(event);
  });
  return events;
}
