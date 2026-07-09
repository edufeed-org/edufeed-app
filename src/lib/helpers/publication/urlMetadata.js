/**
 * Article-URL → publication-form prefill mapping.
 *
 * The server's `/api/reader?mode=metadata` endpoint returns Highwire
 * `citation_*` metadata (plus AMB JSON-LD / OpenGraph) for a fetched page;
 * this module maps that onto the publication form's field shape. Pure —
 * fetch is injected so tests can stub it.
 */

import { normalizeDoi } from './doi.js';

/**
 * @typedef {import('$lib/server/metadataExtraction.js').ExtractedMetadata} ExtractedMetadata
 * @typedef {import('$lib/stores/educational-actions.svelte.js').Creator} Creator
 *
 * @typedef {Object} PublicationPrefill
 * @property {string} [title]
 * @property {Creator[]} [creators]
 * @property {string} [doi]
 * @property {string} [datePublished]
 * @property {string} [journal]
 * @property {string} [inLanguage]
 * @property {string[]} [keywords]
 * @property {string} [abstract]
 * @property {import('./publicationTags.js').PublicationFile} [file]
 */

/**
 * Map extracted page metadata to publication form fields. Citation tags win;
 * OpenGraph fills title/abstract gaps. Returns only the fields that were
 * actually found — callers apply them to empty form fields.
 *
 * @param {ExtractedMetadata} metadata
 * @returns {PublicationPrefill}
 */
export function citationToPublicationPrefill(metadata) {
  /** @type {PublicationPrefill} */
  const prefill = {};
  const citation = metadata?.citation;
  const og = metadata?.og;

  const title = citation?.title || og?.title;
  if (title) prefill.title = title;

  const abstract = citation?.abstract || og?.description;
  if (abstract) prefill.abstract = abstract;

  if (!citation) return prefill;

  if (citation.authors?.length) {
    prefill.creators = citation.authors.map((a) => {
      /** @type {Creator} */
      const creator = { name: a.name, type: 'Person' };
      if (a.institution) creator.affiliationName = a.institution;
      return creator;
    });
  }

  const doi = citation.doi ? normalizeDoi(citation.doi) : null;
  if (doi) prefill.doi = doi;

  if (citation.date) prefill.datePublished = citation.date;
  if (citation.journal) prefill.journal = citation.journal;

  if (citation.language) {
    const lang = citation.language.trim().slice(0, 2).toLowerCase();
    if (/^[a-z]{2}$/.test(lang)) prefill.inLanguage = lang;
  }

  if (citation.keywords?.length) prefill.keywords = citation.keywords;

  // citation_pdf_url is by definition the article's PDF
  if (citation.pdfUrl) prefill.file = { url: citation.pdfUrl, mimeType: 'application/pdf' };

  return prefill;
}

/**
 * Fetch page metadata for an article URL via the reader endpoint and map it
 * to publication form fields. Any failure degrades to `{}` — URL prefill is
 * best-effort and must never block the form.
 *
 * @param {string} url
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<PublicationPrefill>}
 */
export async function fetchPublicationPrefill(url, fetchFn = fetch) {
  try {
    const endpoint = `/api/reader?mode=metadata&url=${encodeURIComponent(url)}`;
    const response = await fetchFn(endpoint);
    if (!response.ok) return {};
    const body = await response.json();
    if (!body?.success || !body.metadata) return {};
    return citationToPublicationPrefill(body.metadata);
  } catch {
    return {};
  }
}
