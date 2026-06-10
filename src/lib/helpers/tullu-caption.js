/**
 * Build a TULLU-rule (Titel, Urheber, Lizenz, Link, Ursprung) attribution
 * line as inline markdown for an image. See:
 *   https://open-educational-resources.de/oer-tullu-regel/
 *
 * Output shape (English locale, with source):
 *   *"Title" by Credit, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), source: https://origin.example*
 *
 * The conjunctions ("by", "source") and the no-title placeholder come from
 * paraglide messages so the caption translates with the user's locale.
 *
 * The helper is pure — given the same inputs it returns the same string. The
 * caller (MarkdownEditor) inserts the returned text into the markdown content
 * immediately after the image tag.
 */
import { formatLicenseUrl } from '$lib/helpers/educational/licenseLabel.js';
import * as m from '$lib/paraglide/messages';

/**
 * @typedef {Object} BuildTulluOptions
 * @property {string} [alt] - Fallback title if the license event has no description.
 */

/**
 * @param {any} licenseEvent - A NIP-94 kind 1063 event (or null).
 * @param {BuildTulluOptions} [options]
 * @returns {string} A single-line italic markdown caption, or empty string if
 *                   the input is unusable.
 */
export function buildTulluCaption(licenseEvent, options = {}) {
  if (!licenseEvent || !Array.isArray(licenseEvent.tags)) return '';

  const tagValue = (/** @type {string} */ name) =>
    licenseEvent.tags.find((/** @type {string[]} */ t) => t[0] === name)?.[1] ?? '';

  const licenseUrl = tagValue('license');
  const credit = tagValue('credit');
  const sourceUrl = tagValue('source');
  const description = (licenseEvent.content || '').trim();

  // No license URL → no meaningful caption.
  if (!licenseUrl) return '';

  const licenseLabel = formatLicenseUrl(licenseUrl) || licenseUrl;
  const title = description || (options.alt ?? '').trim() || m.tullu_no_title();

  const parts = [];
  parts.push(`"${title}"`);
  if (credit) parts.push(`${m.tullu_by()} ${credit}`);
  parts.push(`[${licenseLabel}](${licenseUrl})`);
  if (sourceUrl) parts.push(`${m.tullu_source()}: ${sourceUrl}`);

  return `*${parts.join(', ')}*`;
}
