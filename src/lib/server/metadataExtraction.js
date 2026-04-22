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
 * @typedef {Object} ExtractedMetadata
 * @property {'amb-jsonld' | 'opengraph' | 'none'} source
 * @property {Record<string, any>} [amb]
 * @property {OgMetadata} [og]
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
 * @param {string} html
 * @returns {ExtractedMetadata}
 */
export function extractMetadataFromHtml(html) {
  const { document } = parseHTML(html);

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
    if (amb) return { source: 'amb-jsonld', amb };
  }

  // 2. Open Graph (with twitter:* fallback)
  const og = extractOg(document);
  if (Object.keys(og).length > 0) return { source: 'opengraph', og };

  // 3. Nothing usable
  return { source: 'none' };
}
