/**
 * TULLU attribution for AMB resources (kind 30142).
 *
 * The TULLU rule (https://open-educational-resources.de/oer-tullu-regel/) is
 * the German OER convention for citing openly licensed material:
 *   T – Titel, U – Urheber*in, L – Lizenz, L – Link zur Lizenz, U – Ursprungsort.
 * Model sentence: „Foto ‚Briefe‘ von Jane Doe unter der Lizenz CC BY-SA 2.0 via Flickr“
 * with the license name linked to the license text and the origin linked to
 * where the material was found. Print form writes the URLs out instead.
 *
 * Pure helpers — the component decides locale (template) and visibility.
 */

export const TULLU_RULE_URL = 'https://open-educational-resources.de/oer-tullu-regel/';

/**
 * @typedef {Object} CitationSlots
 * @property {string} title
 * @property {string} creator - All creators, comma separated
 * @property {string} license - Label (+ URL in text form / <a> in HTML form)
 * @property {string} origin - Label (+ URL in text form / <a> in HTML form)
 */

/**
 * @typedef {Object} CitationInput
 * @property {string} title
 * @property {string[]} creators - Names exactly as the creators gave them
 * @property {{ id: string, label: string }} license - License URL + label
 * @property {{ url: string, label: string }} origin - Where the material was found
 */

/**
 * @typedef {Object} Citation
 * @property {string} text - Plain text with URLs written out (print form)
 * @property {string} html - Same sentence with license + origin as links; all
 *   user-supplied values are HTML-escaped
 */

/**
 * Default (German) sentence template — the TULLU model wording.
 * @param {CitationSlots} s
 */
function defaultFormat(s) {
  return `„${s.title}“ von ${s.creator} unter der Lizenz ${s.license} via ${s.origin}`;
}

/**
 * Escape the five HTML special characters for safe interpolation into markup.
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** @param {string} value */
function collapse(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Builds the TULLU sentence in plain-text and HTML form.
 *
 * @param {CitationInput} input
 * @param {(slots: CitationSlots) => string} [format] - Locale sentence template
 *   (e.g. a paraglide message); slot values are already escaped for the HTML
 *   variant, so the template itself must be trusted text.
 * @returns {Citation}
 */
export function buildTulluCitation(input, format = defaultFormat) {
  const title = collapse(input.title);
  const creator = input.creators.map(collapse).filter(Boolean).join(', ');
  const license = { url: input.license.id, label: collapse(input.license.label) };
  const origin = { url: input.origin.url, label: collapse(input.origin.label) };

  const text = format({
    title,
    creator,
    license: `${license.label} (${license.url})`,
    origin: `${origin.label} (${origin.url})`
  });

  const html = format({
    title: escapeHtml(title),
    creator: escapeHtml(creator),
    license: `<a href="${escapeHtml(license.url)}" target="_blank" rel="noopener noreferrer license">${escapeHtml(license.label)}</a>`,
    origin: `<a href="${escapeHtml(origin.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(origin.label)}</a>`
  });

  return { text, html };
}

/**
 * Hostname of a URL without the `www.` prefix, or null when unparsable.
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
function hostLabel(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Ursprungsort: the place the material actually lives. External resources
 * point at their primary URL (mainEntityOfPage, else a URL-shaped d-tag);
 * Nostr-native resources point at this app's page for the record.
 *
 * @param {{ primaryURL?: string | null, identifier?: string | null }} resource
 * @param {{ pageUrl: string, appName: string }} app
 * @returns {{ url: string, label: string }}
 */
export function getCitationOrigin(resource, app) {
  for (const candidate of [resource.primaryURL, resource.identifier]) {
    const label = hostLabel(candidate);
    if (label && candidate) return { url: candidate, label };
  }
  const label = collapse(app.appName) || hostLabel(app.pageUrl) || app.pageUrl;
  return { url: app.pageUrl, label };
}
