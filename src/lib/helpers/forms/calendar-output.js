/**
 * NIP-101 form responses → NIP-52 calendar events: the `nip52-calendar`
 * output target of edufeed's forms profile, as specified in the edufeed wiki
 * entry "Calendar events from forms in edufeed" (targets, dates and times,
 * participants, Bildungsstufe) with the tag shapes of "Calendar events in
 * edufeed".
 *
 * `responseToCalendarDraft` is the composer: answers in, an unsigned draft
 * `{ kind, content, tags }` out, without `d`, `h` or `client` — those belong
 * to the publisher. Its tag order and values match the edufeed WordPress
 * plugin's CalendarComposer, see forms.calendar-interop.test.js.
 *
 * `calendarDraftToFormData` maps such a draft onto CalendarEventModal's form
 * state, so the reviewer publishes it through the app's normal path
 * (buildCalendarEventTags) and a form-based event comes out like a native one.
 *
 * Pure functions — no stores, no network.
 */
import { nip19 } from 'nostr-tools';
import { parseFormTemplate } from './format.js';
import { zonedWallClock } from '../calendar.js';
import {
  buildCalendarEventAttributeTags,
  normalizePriceAmount,
  parseAttendanceMode,
  parseCalendarEventAttributes
} from '../calendar-attributes.js';

/** `settings.output` of a template whose responses compose a calendar event. */
export const CALENDAR_OUTPUT = 'nip52-calendar';

export const DEFAULT_CALENDAR_TZID = 'Europe/Berlin';
export const DEFAULT_CALENDAR_CURRENCY = 'EUR';

const KIND_ALL_DAY = 31922;
const KIND_TIMED = 31923;
const SECONDS_PER_DAY = 86400;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** @typedef {import('./format.js').ParsedFormTemplate} ParsedFormTemplate */
/** @typedef {import('./format.js').FormField} FormField */

/**
 * @typedef {Object} CalendarDraft
 * @property {31922 | 31923} kind
 * @property {string} content
 * @property {string[][]} tags
 */

/**
 * @typedef {Object} CalendarDraftOptions
 * @property {(uri: string) => Record<string, string> | undefined} [conceptLabels] -
 *   prefLabels by language for a concept URI; without labels a concept is
 *   emitted as its `:id` and `:type` only
 * @property {string} [defaultTzid] - zone when nothing answers `cal:tzid`
 * @property {string} [defaultCurrency] - currency when nothing answers `cal:currency`
 */

/**
 * The response cannot form a valid calendar event. `fieldId` names the
 * template field at fault ('' when there is none); `code` says why.
 */
export class CalendarComposeError extends Error {
  /**
   * @param {string} fieldId
   * @param {'required' | 'invalid' | 'end_before_start' | 'unknown_tzid' | 'invalid_currency'} code
   * @param {string} message
   */
  constructor(fieldId, code, message) {
    super(message);
    this.name = 'CalendarComposeError';
    this.fieldId = fieldId;
    this.code = code;
  }
}

/**
 * @param {any} template - a parsed template or a raw kind 30168 event
 * @returns {ParsedFormTemplate | null}
 */
function asParsed(template) {
  if (!template || typeof template !== 'object') return null;
  if (Array.isArray(template.tags)) return parseFormTemplate(template);
  return Array.isArray(template.fields) ? template : null;
}

/**
 * Whether a template's responses compose a NIP-52 calendar event.
 * @param {any} template - a parsed template or a raw kind 30168 event
 * @returns {boolean}
 */
export function isCalendarOutputTemplate(template) {
  return asParsed(template)?.output === CALENDAR_OUTPUT;
}

/**
 * Answers by `cal:` target. A target reads the first field in tag order
 * that has it; `fields` returns all of them (for `cal:participant`).
 */
class Answers {
  /**
   * @param {ParsedFormTemplate} form
   * @param {Record<string, unknown>} values
   */
  constructor(form, values) {
    this.form = form;
    this.values = values || {};
  }

  /** @param {string} target @returns {FormField[]} */
  fields(target) {
    return this.form.fields.filter((f) => f.output === target);
  }

  /** @param {string} target @returns {FormField | undefined} */
  field(target) {
    return this.form.fields.find((f) => f.output === target);
  }

  /** @param {string} target */
  id(target) {
    return this.field(target)?.id ?? '';
  }

  /** The trimmed answer of the first field with this target; '' if none. */
  text(/** @type {string} */ target) {
    const field = this.field(target);
    if (!field) return '';
    const value = this.values[field.id];
    if (Array.isArray(value)) return value.map(String).join(';').trim();
    if (value === undefined || value === null) return '';
    return String(value).trim();
  }

  /** Trimmed non-empty entries of the first field with this target. */
  list(/** @type {string} */ target) {
    const field = this.field(target);
    return field ? this.listOf(field) : [];
  }

  /**
   * Trimmed non-empty entries of one field's answer: an array, or a
   * `;`-joined string as stored in the response.
   * @param {FormField} field
   * @returns {string[]}
   */
  listOf(field) {
    const value = this.values[field.id];
    const entries = Array.isArray(value)
      ? value
      : value === undefined || value === null
        ? []
        : String(value).split(';');
    return entries
      .map((e) => {
        // A vocabulary answer straight from FormConceptPicker carries an id.
        if (e && typeof e === 'object' && 'id' in e) return String(e.id ?? '').trim();
        return String(e ?? '').trim();
      })
      .filter((e) => e.length > 0);
  }
}

/**
 * Compose an unsigned NIP-52 calendar draft from a response to a template
 * with the `nip52-calendar` output.
 *
 * @param {any} template - a parsed template or a raw kind 30168 event
 * @param {Record<string, unknown>} values - fieldId → answer, e.g. from
 *   parseResponseTags(tags, fields); multi-valued answers as arrays or
 *   `;`-joined strings
 * @param {CalendarDraftOptions} [options]
 * @returns {CalendarDraft}
 * @throws {CalendarComposeError} when the answers cannot form a valid event
 */
export function responseToCalendarDraft(template, values, options = {}) {
  const form = asParsed(template);
  if (!form) throw new CalendarComposeError('', 'invalid', 'Not a form template.');
  const answers = new Answers(form, values);

  const title = answers.text('cal:title');
  if (!title) {
    throw new CalendarComposeError(answers.id('cal:title'), 'required', 'A title is required.');
  }

  const allDay = answers.text('cal:allDay') === 'true';

  /** @type {string[][]} */
  const tags = [['title', title]];
  tags.push(...(allDay ? allDayTags(answers) : timedTags(answers, options)));

  const image = answers.text('cal:image');
  if (image) tags.push(['image', image]);

  const location = answers.text('cal:location');
  if (location) tags.push(['location', location]);

  for (const raw of answers.list('cal:t')) {
    const hashtag = raw.replace(/^#+/, '').trim();
    if (hashtag) tags.push(['t', hashtag]);
  }

  for (const link of answers.list('cal:r')) tags.push(['r', link]);

  tags.push(...participantTags(answers));
  tags.push(...attributeTags(answers, options));

  return {
    kind: allDay ? KIND_ALL_DAY : KIND_TIMED,
    content: answers.text('cal:content'),
    tags
  };
}

/**
 * All-day: `YYYY-MM-DD`. The end answer is the last day; NIP-52's `end` is
 * exclusive, so a one-day event gets no end and a longer one last day + 1.
 * @param {Answers} answers
 * @returns {string[][]}
 */
function allDayTags(answers) {
  const startId = answers.id('cal:start');
  const endId = answers.id('cal:end');

  const start = parseDay(answers.text('cal:start'), startId);
  if (start === null) {
    throw new CalendarComposeError(startId, 'required', 'A start date is required.');
  }
  /** @type {string[][]} */
  const tags = [['start', isoDay(start)]];

  const end = parseDay(answers.text('cal:end'), endId);
  if (end !== null) {
    if (end < start) {
      throw new CalendarComposeError(endId, 'end_before_start', 'The end lies before the start.');
    }
    if (end > start) tags.push(['end', isoDay(end + SECONDS_PER_DAY)]);
  }
  return tags;
}

/**
 * Timed: local `YYYY-MM-DDTHH:MM` in the `cal:tzid` zone, written as unix
 * seconds with both tzid tags and one `D` per day covered.
 * @param {Answers} answers
 * @param {CalendarDraftOptions} options
 * @returns {string[][]}
 */
function timedTags(answers, options) {
  const startId = answers.id('cal:start');
  const endId = answers.id('cal:end');

  const tzField = answers.field('cal:tzid');
  const tzid =
    answers.text('cal:tzid') ||
    tzField?.defaultValue?.trim() ||
    options.defaultTzid ||
    DEFAULT_CALENDAR_TZID;
  if (!isTimeZone(tzid)) {
    throw new CalendarComposeError(tzField?.id ?? '', 'unknown_tzid', `Unknown time zone: ${tzid}`);
  }

  const start = parseWallClock(answers.text('cal:start'), tzid, startId);
  if (start === null) {
    throw new CalendarComposeError(startId, 'required', 'A start date and time are required.');
  }
  let end = parseWallClock(answers.text('cal:end'), tzid, endId);
  if (end !== null && end < start) {
    throw new CalendarComposeError(endId, 'end_before_start', 'The end lies before the start.');
  }
  // NIP-52: start "must be less than end, if it exists".
  if (end === start) end = null;

  /** @type {string[][]} */
  const tags = [['start', String(start)]];
  if (end !== null) tags.push(['end', String(end)]);
  tags.push(['start_tzid', tzid]);
  // One time zone field serves both ends.
  if (end !== null) tags.push(['end_tzid', tzid]);

  // NIP-52 end is exclusive: an end at 00:00 UTC does not cover that day.
  const lastDay =
    end === null ? Math.floor(start / SECONDS_PER_DAY) : Math.floor((end - 1) / SECONDS_PER_DAY);
  for (let day = Math.floor(start / SECONDS_PER_DAY); day <= lastDay; day++) {
    tags.push(['D', String(day)]);
  }
  return tags;
}

/**
 * `p` tags for Nostr keys, then `participant` tags for names. The one target
 * that aggregates all its fields (each field carries its own role); a
 * duplicate by pubkey or by name is emitted once, first occurrence wins.
 * @param {Answers} answers
 * @returns {string[][]}
 */
function participantTags(answers) {
  /** @type {Map<string, string[]>} */
  const pTags = new Map();
  /** @type {Map<string, string[]>} */
  const nameTags = new Map();

  for (const field of answers.fields('cal:participant')) {
    const rawRole = field.options?.participantRole;
    const role = typeof rawRole === 'string' ? rawRole.trim() : '';
    for (const entry of answers.listOf(field)) {
      const key = participantKey(entry, field.id);
      if (key) {
        if (!pTags.has(key.pubkey))
          pTags.set(key.pubkey, withRole(['p', key.pubkey, key.relay], role));
      } else if (!nameTags.has(entry)) {
        nameTags.set(entry, withRole(['participant', entry, ''], role));
      }
    }
  }
  return [...pTags.values(), ...nameTags.values()];
}

/**
 * @param {string} entry
 * @param {string} fieldId
 * @returns {{ pubkey: string, relay: string } | null} null for a plain name
 */
function participantKey(entry, fieldId) {
  if (/^[0-9a-f]{64}$/i.test(entry)) return { pubkey: entry.toLowerCase(), relay: '' };
  if (entry.startsWith('npub1') || entry.startsWith('nprofile1')) {
    try {
      const decoded = nip19.decode(entry);
      if (decoded.type === 'npub') return { pubkey: decoded.data, relay: '' };
      if (decoded.type === 'nprofile') {
        return { pubkey: decoded.data.pubkey, relay: decoded.data.relays?.[0] || '' };
      }
    } catch {
      // fall through to the error below
    }
    throw new CalendarComposeError(fieldId, 'invalid', `Not a valid Nostr key: ${entry}`);
  }
  return null;
}

/**
 * Append the role; without one the role slot is left out, and an empty
 * relay slot with it.
 * @param {string[]} tag
 * @param {string} role
 */
function withRole(tag, role) {
  if (role) return [...tag, role];
  return tag[2] === '' ? [tag[0], tag[1]] : tag;
}

/**
 * registrationRequired, price, eventAttendanceMode and the educationalLevel
 * concept triples — through the app's own attribute builder, so these tags
 * are exactly what a native event carries.
 * @param {Answers} answers
 * @param {CalendarDraftOptions} options
 * @returns {string[][]}
 */
function attributeTags(answers, options) {
  /** @type {import('../calendar-attributes.js').CalendarEventAttributes} */
  const attributes = { educationalLevels: [] };

  const registration = answers.text('cal:registrationRequired');
  if (registration === 'true' || registration === 'false') {
    attributes.registrationRequired = registration === 'true';
  }

  const amount = normalizePriceAmount(answers.text('cal:price'));
  if (amount !== undefined) {
    const currencyField = answers.field('cal:currency');
    const currency = (
      answers.text('cal:currency') ||
      currencyField?.defaultValue?.trim() ||
      options.defaultCurrency ||
      DEFAULT_CALENDAR_CURRENCY
    ).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new CalendarComposeError(
        currencyField?.id ?? '',
        'invalid_currency',
        `Not an ISO 4217 currency code: ${currency}`
      );
    }
    attributes.price = { amount, currency };
  }

  const mode = parseAttendanceMode(answers.text('cal:eventAttendanceMode'));
  if (mode) attributes.attendanceMode = mode;

  for (const id of answers.list('cal:educationalLevel')) {
    const labels = options.conceptLabels?.(id) || {};
    attributes.educationalLevels.push({ id, labels: { ...labels } });
  }

  return buildCalendarEventAttributeTags(attributes);
}

/**
 * Unix seconds of UTC midnight for a `YYYY-MM-DD` answer; null when empty.
 * @param {string} answer
 * @param {string} fieldId
 * @returns {number | null}
 */
function parseDay(answer, fieldId) {
  if (!answer) return null;
  const m = DATE_PATTERN.exec(answer);
  const ms = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  if (!m || !Number.isFinite(ms) || isoDay(ms / 1000) !== answer) {
    throw new CalendarComposeError(fieldId, 'invalid', `Not a valid date: ${answer}`);
  }
  return ms / 1000;
}

/** @param {number} seconds */
function isoDay(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/**
 * Unix seconds for a local `YYYY-MM-DDTHH:MM` answer in `tzid`; null when
 * empty. A wall-clock time a DST switch skips resolves forward, like PHP's
 * DateTime does.
 * @param {string} answer
 * @param {string} tzid
 * @param {string} fieldId
 * @returns {number | null}
 */
function parseWallClock(answer, tzid, fieldId) {
  if (!answer) return null;
  const m = DATETIME_PATTERN.exec(answer);
  const wall = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : NaN;
  if (
    !m ||
    !Number.isFinite(wall) ||
    new Date(wall).toISOString().slice(0, 16) !== answer ||
    +m[4] > 23
  ) {
    throw new CalendarComposeError(fieldId, 'invalid', `Not a valid date and time: ${answer}`);
  }
  // Offset at the wall-clock instant read as UTC, then re-checked at the
  // candidate: two passes settle every offset change but a skipped hour.
  let utc = wall - zoneOffsetMs(wall, tzid);
  const second = wall - zoneOffsetMs(utc, tzid);
  if (second !== utc) utc = Math.max(utc, second);
  return Math.floor(utc / 1000);
}

/**
 * The zone's UTC offset in ms at an instant.
 * @param {number} ms
 * @param {string} tzid
 */
function zoneOffsetMs(ms, tzid) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tzid,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second
  );
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** @param {string} tzid */
function isTimeZone(tzid) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tzid });
    return true;
  } catch {
    return false;
  }
}

/**
 * CalendarEventModal form state for a calendar draft, for the create-from-
 * response flow. The all-day end shows the inclusive last day the form works
 * with (NIP-52 end − 1 day, or the start day without an end); timed fields
 * are wall-clock values in the draft's zones (start in start_tzid, end in
 * end_tzid or else start_tzid), the zones the edit form reads them back in,
 * so the reviewer's own zone never shifts the draft's instants.
 *
 * @param {CalendarDraft} draft
 * @param {{ fallbackTimezone?: string }} [options]
 * @returns {import('../../types/calendar.js').EventFormData}
 */
export function calendarDraftToFormData(draft, options = {}) {
  const tags = Array.isArray(draft?.tags) ? draft.tags : [];
  /** @param {string} name */
  const first = (name) => tags.find((t) => t[0] === name)?.[1] ?? '';
  /** @param {string} name */
  const all = (name) => tags.filter((t) => t[0] === name && t[1]).map((t) => t[1]);

  const isAllDay = draft?.kind === KIND_ALL_DAY;
  const fallbackTz = options.fallbackTimezone || DEFAULT_CALENDAR_TZID;
  const startTimezone = first('start_tzid') || fallbackTz;
  const endTimezone = first('end_tzid') || startTimezone;

  let startDate = '';
  let startTime = '09:00';
  let endDate = '';
  let endTime = '10:00';
  if (isAllDay) {
    startDate = first('start');
    const end = first('end');
    const endSeconds = end && DATE_PATTERN.test(end) ? Date.parse(`${end}T00:00:00Z`) / 1000 : NaN;
    endDate = Number.isFinite(endSeconds) ? isoDay(endSeconds - SECONDS_PER_DAY) : startDate;
    if (endDate < startDate) endDate = startDate;
  } else {
    const start = Number(first('start'));
    if (Number.isFinite(start) && start > 0) {
      ({ date: startDate, time: startTime } = zonedWallClock(start, startTimezone));
    }
    const end = Number(first('end'));
    if (first('end') && Number.isFinite(end) && end > 0) {
      ({ date: endDate, time: endTime } = zonedWallClock(end, endTimezone));
    }
  }

  /** @type {import('../../types/calendar.js').CalendarEventParticipant[]} */
  const participants = [];
  for (const tag of tags) {
    if (tag[0] === 'p' && tag[1]) {
      /** @type {import('../../types/calendar.js').CalendarEventParticipant} */
      const p = { pubkey: tag[1] };
      if (tag[2]) p.relay = tag[2];
      if (tag[3]) p.role = tag[3];
      participants.push(p);
    }
  }
  for (const tag of tags) {
    if (tag[0] === 'participant' && tag[1]) {
      /** @type {import('../../types/calendar.js').CalendarEventParticipant} */
      const p = { name: tag[1] };
      if (tag[3]) p.role = tag[3];
      participants.push(p);
    }
  }

  return {
    title: first('title'),
    summary: typeof draft?.content === 'string' ? draft.content : '',
    image: first('image'),
    imageWasUploaded: false,
    imageLicenseEvent: null,
    startDate,
    startTime,
    endDate,
    endTime,
    startTimezone,
    endTimezone,
    location: first('location'),
    isAllDay,
    eventType: isAllDay ? 'date' : 'time',
    references: all('r'),
    hashtags: all('t'),
    participants,
    attributes: parseCalendarEventAttributes(tags)
  };
}
