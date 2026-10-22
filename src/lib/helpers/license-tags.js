/**
 * Indexing tags on kind-1063 license attestations: free keywords (`t`, NIP-24)
 * and controlled subjects (`about:*` concept triples, the same NIP-AMB
 * flattening kind 30142 and the calendar events use). Both are optional; a
 * 1063 without them is simply "not indexed". Pure helpers, no I/O.
 *
 *   ["t", "barcamp"]
 *   ["about:id", "http://w3id.org/kim/schulfaecher/s1055"]
 *   ["about:prefLabel:de", "Religion"]
 *   ["about:type", "Concept"]
 *
 * Read rules: `about:id` is authoritative and opens a concept, the
 * `prefLabel`s that follow belong to it; duplicates are read once; the
 * display label falls back to the last URI segment when no prefLabel is
 * carried.
 */
import { unique, uniqueBy } from './unique.js';

const SUBJECT = 'about';

/**
 * @typedef {Object} LicenseSubject
 * @property {string} id - Concept URI (authoritative)
 * @property {Record<string, string>} labels - prefLabel by language (display copy)
 */

/**
 * One keyword in NIP-24 form: trimmed, without a leading `#`, lowercase.
 * Returns '' when nothing is left.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeKeyword(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/^#+/, '').trim().toLowerCase();
}

/**
 * Normalize and dedupe a keyword list, dropping empties.
 * @param {unknown} list
 * @returns {string[]}
 */
export function normalizeKeywords(list) {
  if (!Array.isArray(list)) return [];
  return unique(list.map(normalizeKeyword).filter(Boolean));
}

/**
 * `t` tags for the keywords, one per keyword.
 * @param {unknown} keywords
 * @returns {string[][]}
 */
export function buildKeywordTags(keywords) {
  return normalizeKeywords(keywords).map((k) => ['t', k]);
}

/**
 * `about:*` triples for the subjects — groups contiguous, German label first
 * (the language the spec's examples carry), `about:type` closing each group.
 * @param {Partial<LicenseSubject>[] | undefined | null} subjects
 * @returns {string[][]}
 */
export function buildSubjectTags(subjects) {
  /** @type {string[][]} */
  const tags = [];
  const concepts = uniqueBy(
    (subjects || []).filter((c) => typeof c?.id === 'string' && c.id.trim()),
    (c) => /** @type {string} */ (c.id).trim()
  );
  for (const concept of concepts) {
    tags.push([`${SUBJECT}:id`, /** @type {string} */ (concept.id).trim()]);
    const langs = unique(Object.keys(concept.labels || {})).sort((a, b) =>
      a === 'de' ? -1 : b === 'de' ? 1 : a.localeCompare(b)
    );
    for (const lang of langs) {
      const label = concept.labels?.[lang];
      if (typeof label === 'string' && label.trim()) {
        tags.push([`${SUBJECT}:prefLabel:${lang}`, label.trim()]);
      }
    }
    tags.push([`${SUBJECT}:type`, 'Concept']);
  }
  return tags;
}

/**
 * Keywords of a 1063 (`t` tags), read as written, trimmed and deduped.
 * @param {{ tags?: string[][] } | null | undefined} event
 * @returns {string[]}
 */
export function getLicenseKeywords(event) {
  const tags = Array.isArray(event?.tags) ? event.tags : [];
  return unique(
    tags
      .filter((t) => Array.isArray(t) && t[0] === 't' && typeof t[1] === 'string')
      .map((t) => t[1].trim())
      .filter(Boolean)
  );
}

/**
 * Subjects of a 1063 (`about:*` triples), grouped by the `about:id` that
 * opens each concept. Tags are untrusted input: repeated ids are read once.
 * @param {{ tags?: string[][] } | null | undefined} event
 * @returns {LicenseSubject[]}
 */
export function getLicenseSubjects(event) {
  const tags = Array.isArray(event?.tags) ? event.tags : [];
  /** @type {LicenseSubject[]} */
  const subjects = [];
  /** @type {LicenseSubject | null} */
  let current = null;
  for (const tag of tags) {
    if (!Array.isArray(tag) || typeof tag[0] !== 'string') continue;
    const [name, value] = tag;
    if (name === `${SUBJECT}:id`) {
      current = null;
      if (typeof value === 'string' && value.trim()) {
        current = { id: value.trim(), labels: {} };
        subjects.push(current);
      }
    } else if (name.startsWith(`${SUBJECT}:prefLabel:`) && current) {
      const lang = name.slice(`${SUBJECT}:prefLabel:`.length);
      if (lang && typeof value === 'string' && value.trim() && !current.labels[lang]) {
        current.labels[lang] = value.trim();
      }
    }
  }
  return uniqueBy(subjects, (c) => c.id);
}

/**
 * Display label of a subject: the requested locale, then de, then en, then
 * any label, then the last segment of the URI.
 * @param {Partial<LicenseSubject> | null | undefined} subject
 * @param {string} [locale]
 * @returns {string}
 */
export function getSubjectLabel(subject, locale = 'de') {
  const labels = subject?.labels || {};
  const picked = labels[locale] || labels.de || labels.en || Object.values(labels)[0];
  if (picked) return picked;
  const id = (subject?.id || '').replace(/[/#]+$/, '');
  const segment = id.split(/[/#]/).pop() || '';
  try {
    return decodeURIComponent(segment) || id;
  } catch {
    return segment || id;
  }
}
