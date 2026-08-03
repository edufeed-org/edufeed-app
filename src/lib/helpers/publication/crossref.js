/**
 * DOI → publication-form prefill via the Crossref REST API.
 *
 * Mirrors urlMetadata.js: a pure mapping from a Crossref work message onto
 * the publication form's field shape, plus a best-effort fetch wrapper with
 * injectable fetch. The Crossref API serves CORS to browsers, so no proxy is
 * needed; a `mailto` politeness parameter can be added once a contact
 * address is configured.
 */

import { normalizeDoi } from './doi.js';

/**
 * @typedef {import('./urlMetadata.js').PublicationPrefill} PublicationPrefill
 * @typedef {import('$lib/stores/educational-actions.svelte.js').Creator} Creator
 *
 * @typedef {PublicationPrefill & { volume?: string, issue?: string, publisher?: string }} DoiPrefill
 */

/**
 * Strip the JATS tags Crossref embeds in `abstract`
 * (`<jats:p>`, `<jats:italic>`, …) down to plain text.
 * @param {string} s
 * @returns {string}
 */
function stripJats(s) {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Map a Crossref REST work message (`response.message` of
 * `GET https://api.crossref.org/works/<doi>`) to publication form fields.
 * Returns only fields actually present — callers apply them to empty form
 * fields only, never overwriting user input.
 *
 * @param {any} work
 * @returns {DoiPrefill}
 */
export function crossrefWorkToPrefill(work) {
  /** @type {DoiPrefill} */
  const prefill = {};
  if (!work || typeof work !== 'object') return prefill;

  const title = Array.isArray(work.title) ? work.title[0] : work.title;
  if (title) prefill.title = String(title);

  if (Array.isArray(work.author) && work.author.length) {
    /** @type {Creator[]} */
    const creators = [];
    for (const a of work.author) {
      const name = [a.given, a.family].filter(Boolean).join(' ') || a.name;
      if (!name) continue;
      /** @type {Creator} */
      const creator = { name, type: a.name && !a.family ? 'Organization' : 'Person' };
      // Crossref serves ORCID as the canonical https URI already, but has
      // historically flip-flopped between http/https — normalize to https.
      if (a.ORCID) creator.orcid = String(a.ORCID).replace(/^http:\/\//, 'https://');
      if (Array.isArray(a.affiliation) && a.affiliation[0]?.name)
        creator.affiliationName = a.affiliation[0].name;
      creators.push(creator);
    }
    if (creators.length) prefill.creators = creators;
  }

  const doi = work.DOI ? normalizeDoi(work.DOI) : null;
  if (doi) prefill.doi = doi;

  // issued.date-parts: [[year, month?, day?]] — emit as much as is present.
  const parts = work.issued?.['date-parts']?.[0];
  if (Array.isArray(parts) && parts.length && Number.isFinite(parts[0])) {
    prefill.datePublished = parts
      .slice(0, 3)
      .map((n, i) => (i === 0 ? String(n) : String(n).padStart(2, '0')))
      .join('-');
  }

  const journal = Array.isArray(work['container-title'])
    ? work['container-title'][0]
    : work['container-title'];
  if (journal) prefill.journal = String(journal);

  if (work.volume) prefill.volume = String(work.volume);
  if (work.issue) prefill.issue = String(work.issue);
  if (work.publisher) prefill.publisher = String(work.publisher);

  if (typeof work.language === 'string') {
    const lang = work.language.trim().slice(0, 2).toLowerCase();
    if (/^[a-z]{2}$/.test(lang)) prefill.inLanguage = lang;
  }

  if (Array.isArray(work.subject) && work.subject.length) {
    prefill.keywords = work.subject.map(String);
  }

  if (typeof work.abstract === 'string' && work.abstract.trim()) {
    const abstract = stripJats(work.abstract);
    if (abstract) prefill.abstract = abstract;
  }

  return prefill;
}

/**
 * Fetch a DOI's metadata from Crossref and map it to publication form
 * fields. Any failure — invalid DOI, network error, 404, malformed body —
 * degrades to `{}`: DOI prefill is best-effort and must never block the
 * form.
 *
 * @param {string} doiInput - DOI in any accepted form (bare, doi:, URL)
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<DoiPrefill>}
 */
export async function fetchDoiPrefill(doiInput, fetchFn = fetch) {
  const doi = normalizeDoi(doiInput);
  if (!doi) return {};
  try {
    const response = await fetchFn(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
    if (!response.ok) return {};
    const body = await response.json();
    if (body?.status !== 'ok' || !body.message) return {};
    return crossrefWorkToPrefill(body.message);
  } catch {
    return {};
  }
}
