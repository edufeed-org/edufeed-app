/**
 * Server-side metadata extraction for the AMB resource wizard.
 *
 * Parses fetched HTML and returns either AMB JSON-LD (preferred) or Open Graph
 * metadata (fallback). The wizard uses this to prefill the form when the user
 * enters a URL in step 2.
 */
import { parseHTML } from 'linkedom';

/**
 * @typedef {Object} OgMetadata
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [image]
 * @property {string} [siteName]
 * @property {string} [locale]
 */

/**
 * @typedef {Object} CitationAuthor
 * @property {string} name
 * @property {string} [institution]
 */

/**
 * @typedef {Object} CitationMetadata
 * @property {string} [title]
 * @property {CitationAuthor[]} authors
 * @property {string} [doi]
 * @property {string} [date] - ISO date (YYYY-MM-DD or YYYY-MM / YYYY)
 * @property {string} [journal]
 * @property {string} [language]
 * @property {string[]} keywords
 * @property {string} [abstract]
 * @property {string} [pdfUrl]
 */

/**
 * @typedef {Object} ExtractedMetadata
 * @property {'amb-jsonld' | 'opengraph' | 'none'} source
 * @property {Record<string, any>} [amb]
 * @property {OgMetadata} [og]
 * @property {CitationMetadata} [citation] - Highwire `citation_*` meta when
 *   present (scholarly pages, e.g. OJS journals). Orthogonal to `source` so
 *   existing consumers are unaffected.
 */

const AMB_CONTEXT = 'https://w3id.org/kim/amb/context.jsonld';

/**
 * @param {unknown} ctx
 * @returns {boolean}
 */
function contextIsAmb(ctx) {
  if (typeof ctx === 'string') return ctx === AMB_CONTEXT;
  if (Array.isArray(ctx)) return ctx.some(contextIsAmb);
  if (ctx && typeof ctx === 'object') {
    return Object.values(/** @type {Record<string, unknown>} */ (ctx)).some(contextIsAmb);
  }
  return false;
}

/**
 * @param {unknown} parsed - parsed JSON from a single ld+json block
 * @returns {Record<string, any> | undefined}
 */
function findAmbInJsonLd(parsed) {
  if (!parsed) return undefined;
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const found = findAmbInJsonLd(item);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof parsed === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (parsed);
    if (contextIsAmb(obj['@context'])) return /** @type {Record<string, any>} */ (parsed);
  }
  return undefined;
}

/**
 * Extract Open Graph metadata, falling back to twitter:* meta tags per field.
 *
 * @param {Document} document
 * @returns {OgMetadata}
 */
function extractOg(document) {
  /**
   * @param {string} ogProp
   * @param {string} twitterName
   * @returns {string | undefined}
   */
  const pick = (ogProp, twitterName) => {
    const og = document.querySelector(`meta[property="og:${ogProp}"]`);
    if (og?.getAttribute('content')) return og.getAttribute('content') ?? undefined;
    const tw = document.querySelector(`meta[name="twitter:${twitterName}"]`);
    return tw?.getAttribute('content') ?? undefined;
  };

  /** @type {OgMetadata} */
  const og = {};
  const title = pick('title', 'title');
  const description = pick('description', 'description');
  const image = pick('image', 'image');
  const siteName = pick('site_name', 'site');
  const locale = pick('locale', 'locale');

  if (title) og.title = title;
  if (description) og.description = description;
  if (image) og.image = image;
  if (siteName) og.siteName = siteName;
  if (locale) og.locale = locale;

  return og;
}

/**
 * Normalize Highwire citation dates: OJS emits `YYYY/MM/DD`, others already
 * use ISO. Returns undefined for anything that doesn't start with a year.
 *
 * @param {string | undefined} raw
 * @returns {string | undefined}
 */
function normalizeCitationDate(raw) {
  const s = (raw ?? '').trim().replace(/\//g, '-');
  return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(s) ? s : undefined;
}

/**
 * Extract Highwire Press `citation_*` meta tags (scholarly pages: OJS, DSpace,
 * arXiv, ...). Authors and their institutions are paired by document order —
 * `citation_author_institution` applies to the preceding `citation_author`.
 *
 * @param {Document} document
 * @returns {CitationMetadata | undefined} undefined when no citation tags exist
 */
function extractCitation(document) {
  const metas = [...document.querySelectorAll('meta[name^="citation_"]')];
  if (metas.length === 0) return undefined;

  /** @type {CitationMetadata} */
  const citation = { authors: [], keywords: [] };
  /** @type {Record<string, string>} */
  const single = {};

  for (const meta of metas) {
    const name = meta.getAttribute('name') ?? '';
    const content = meta.getAttribute('content')?.trim();
    if (!content) continue;
    if (name === 'citation_author') {
      citation.authors.push({ name: content });
    } else if (name === 'citation_author_institution') {
      const last = citation.authors[citation.authors.length - 1];
      if (last && !last.institution) last.institution = content;
    } else if (name === 'citation_keywords') {
      citation.keywords.push(content);
    } else if (!(name in single)) {
      single[name] = content;
    }
  }

  if (single.citation_title) citation.title = single.citation_title;
  if (single.citation_doi) citation.doi = single.citation_doi;
  const date = normalizeCitationDate(
    single.citation_date ?? single.citation_publication_date ?? single.citation_online_date
  );
  if (date) citation.date = date;
  if (single.citation_journal_title) citation.journal = single.citation_journal_title;
  if (single.citation_language) citation.language = single.citation_language;
  if (single.citation_abstract) citation.abstract = single.citation_abstract;
  if (single.citation_pdf_url) citation.pdfUrl = single.citation_pdf_url;

  // OJS pages usually put the abstract in DC.Description instead
  if (!citation.abstract) {
    const dc =
      document.querySelector('meta[name="DC.Description"]') ??
      document.querySelector('meta[name="dc.description"]');
    const dcContent = dc?.getAttribute('content')?.trim();
    if (dcContent) citation.abstract = dcContent;
  }

  return citation;
}

/**
 * @param {string} html
 * @returns {ExtractedMetadata}
 */
export function extractMetadataFromHtml(html) {
  const { document } = parseHTML(html);

  const citation = extractCitation(document);

  // 1. AMB JSON-LD (preferred)
  const ldNodes = document.querySelectorAll('script[type="application/ld+json"]');
  for (const node of ldNodes) {
    const text = node.textContent?.trim();
    if (!text) continue;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const amb = findAmbInJsonLd(parsed);
    if (amb)
      return citation ? { source: 'amb-jsonld', amb, citation } : { source: 'amb-jsonld', amb };
  }

  // 2. Open Graph (with twitter:* fallback)
  const og = extractOg(document);
  if (Object.keys(og).length > 0) {
    return citation ? { source: 'opengraph', og, citation } : { source: 'opengraph', og };
  }

  // 3. No amb/og — citation may still exist (source stays 'none' so existing
  // consumers keep their fallback behavior)
  return citation ? { source: 'none', citation } : { source: 'none' };
}
