/**
 * Educational calendar event attributes ("NIP-52-Edufeed", issue #13).
 *
 * Additive tags on NIP-52 calendar events (kinds 31922/31923), tag names
 * fixed by the Edufeed working group on 2026-07-06:
 *
 *   ["registrationRequired", "true" | "false"]          absent = no statement
 *   ["price", "<amount>", "<ISO-4217 currency>"]        absent/empty = no statement,
 *                                                       0 = free, > 0 = paid
 *   ["eventAttendanceMode", "https://schema.org/{Online|Offline|Mixed}EventAttendanceMode"]
 *   ["educationalLevel:id", uri] ["educationalLevel:prefLabel:<lang>", label]
 *   ["educationalLevel:type", "Concept"]                NIP-AMB concept triple, repeated
 *
 * Pure functions — no stores, no network.
 */

import { unique, uniqueBy } from '$lib/helpers/unique.js';

/** @typedef {'online' | 'offline' | 'mixed'} AttendanceMode */

/**
 * @typedef {Object} EventConcept
 * @property {string} id - Concept URI (authoritative)
 * @property {Record<string, string>} labels - prefLabel by language (display copy)
 */

/**
 * @typedef {Object} EventPrice
 * @property {string} amount - Non-negative decimal string, e.g. "0", "25", "12.50"
 * @property {string} currency - ISO 4217 code, e.g. "EUR" ('' when the tag had none)
 */

/**
 * @typedef {Object} CalendarEventAttributes
 * @property {boolean} [registrationRequired] - undefined = no statement
 * @property {EventPrice} [price] - undefined = no statement
 * @property {AttendanceMode} [attendanceMode] - undefined = no statement
 * @property {EventConcept[]} educationalLevels
 */

/** @type {Record<AttendanceMode, string>} */
export const ATTENDANCE_MODE_URIS = {
  online: 'https://schema.org/OnlineEventAttendanceMode',
  offline: 'https://schema.org/OfflineEventAttendanceMode',
  mixed: 'https://schema.org/MixedEventAttendanceMode'
};

export const DEFAULT_CURRENCY = 'EUR';

const EDU_LEVEL = 'educationalLevel';

/** @returns {CalendarEventAttributes} */
export function emptyEventAttributes() {
  return { educationalLevels: [] };
}

/**
 * Normalise a user- or network-supplied amount: trims, accepts a decimal
 * comma, rejects anything that is not a non-negative number.
 * @param {unknown} raw
 * @returns {string | undefined}
 */
export function normalizePriceAmount(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const text = String(raw).trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(text)) return undefined;
  return text;
}

/**
 * 'free' for an amount of 0, 'paid' for > 0, undefined when no statement.
 * @param {EventPrice | undefined} price
 * @returns {'free' | 'paid' | undefined}
 */
export function getPriceKind(price) {
  const amount = normalizePriceAmount(price?.amount);
  if (amount === undefined) return undefined;
  return Number(amount) === 0 ? 'free' : 'paid';
}

/**
 * Map an eventAttendanceMode tag value to its short form. Tolerates the
 * http:// scheme and a bare schema.org term, since other clients vary.
 * @param {string | undefined} value
 * @returns {AttendanceMode | undefined}
 */
export function parseAttendanceMode(value) {
  if (typeof value !== 'string') return undefined;
  const term = value.trim().split('/').pop();
  if (term === 'OnlineEventAttendanceMode') return 'online';
  if (term === 'OfflineEventAttendanceMode') return 'offline';
  if (term === 'MixedEventAttendanceMode') return 'mixed';
  return undefined;
}

/**
 * Parse the extension attributes from a calendar event's tags.
 * @param {string[][] | undefined} tags
 * @returns {CalendarEventAttributes}
 */
export function parseCalendarEventAttributes(tags) {
  /** @type {CalendarEventAttributes} */
  const attributes = emptyEventAttributes();
  if (!Array.isArray(tags)) return attributes;

  /** @type {EventConcept[]} */
  const levels = [];
  /** @type {EventConcept | null} */
  let currentLevel = null;

  for (const tag of tags) {
    if (!Array.isArray(tag) || typeof tag[0] !== 'string') continue;
    const [name, value] = tag;

    if (name === 'registrationRequired' && attributes.registrationRequired === undefined) {
      if (value === 'true') attributes.registrationRequired = true;
      else if (value === 'false') attributes.registrationRequired = false;
    } else if (name === 'price' && !attributes.price) {
      const amount = normalizePriceAmount(value);
      if (amount !== undefined) {
        attributes.price = {
          amount,
          currency: typeof tag[2] === 'string' ? tag[2].trim().toUpperCase() : ''
        };
      }
    } else if (name === 'eventAttendanceMode' && !attributes.attendanceMode) {
      attributes.attendanceMode = parseAttendanceMode(value);
    } else if (name === `${EDU_LEVEL}:id`) {
      // NIP-AMB flattening writes each concept as an interleaved triple, so
      // an :id opens a concept and the following prefLabels belong to it.
      currentLevel = null;
      if (typeof value === 'string' && value.trim()) {
        currentLevel = { id: value.trim(), labels: {} };
        levels.push(currentLevel);
      }
    } else if (name.startsWith(`${EDU_LEVEL}:prefLabel:`) && currentLevel) {
      const lang = name.slice(`${EDU_LEVEL}:prefLabel:`.length);
      if (lang && typeof value === 'string' && value && !currentLevel.labels[lang]) {
        currentLevel.labels[lang] = value;
      }
    }
  }

  // Tags are untrusted input: a repeated concept would collide in keyed #each.
  attributes.educationalLevels = uniqueBy(levels, (c) => c.id);
  return attributes;
}

/**
 * Build the extension tags. Statements that are absent produce no tag, so
 * "keine Angabe" round-trips as absence.
 * @param {Partial<CalendarEventAttributes> | undefined} attributes
 * @returns {string[][]}
 */
export function buildCalendarEventAttributeTags(attributes) {
  /** @type {string[][]} */
  const tags = [];
  if (!attributes) return tags;

  if (typeof attributes.registrationRequired === 'boolean') {
    tags.push(['registrationRequired', String(attributes.registrationRequired)]);
  }

  const amount = normalizePriceAmount(attributes.price?.amount);
  if (amount !== undefined) {
    const currency = (attributes.price?.currency || '').trim().toUpperCase();
    tags.push(currency ? ['price', amount, currency] : ['price', amount]);
  }

  const modeUri = attributes.attendanceMode && ATTENDANCE_MODE_URIS[attributes.attendanceMode];
  if (modeUri) tags.push(['eventAttendanceMode', modeUri]);

  const levels = uniqueBy(
    (attributes.educationalLevels || []).filter((c) => c?.id),
    (c) => c.id
  );
  for (const concept of levels) {
    tags.push([`${EDU_LEVEL}:id`, concept.id]);
    // German first: it is the language the spec's examples carry.
    const langs = unique(Object.keys(concept.labels || {})).sort((a, b) =>
      a === 'de' ? -1 : b === 'de' ? 1 : a.localeCompare(b)
    );
    for (const lang of langs) {
      const label = concept.labels[lang];
      if (label) tags.push([`${EDU_LEVEL}:prefLabel:${lang}`, label]);
    }
    tags.push([`${EDU_LEVEL}:type`, 'Concept']);
  }

  return tags;
}

/**
 * Whether the event says anything at all via the extension attributes.
 * @param {CalendarEventAttributes | undefined} attributes
 * @returns {boolean}
 */
export function hasEventAttributes(attributes) {
  if (!attributes) return false;
  return (
    attributes.registrationRequired !== undefined ||
    getPriceKind(attributes.price) !== undefined ||
    attributes.attendanceMode !== undefined ||
    (attributes.educationalLevels?.length ?? 0) > 0
  );
}
