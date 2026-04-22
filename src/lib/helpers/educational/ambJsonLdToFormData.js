/**
 * Adapters that turn fetched page metadata into a shape the AMB wizard can
 * prefill from.
 *
 * Two sources, two shapes:
 *   - AMB JSON-LD → synthesize a kind 30142 event object whose tags are already
 *     readable by the existing `getAMB*` helpers in `ambHelpers.js`. This lets
 *     the wizard's edit-mode prefill path be reused verbatim.
 *   - Open Graph → map the small set of OG fields to the form data shape
 *     directly (name, description, image, inLanguage).
 */

import { ambToNostr } from 'amb-nostr-converter';

/**
 * Normalize JSON-LD at-prefixed keys (the "\@type" / "\@id" forms) to their
 * plain counterparts so `ambToNostr` accepts them. Shallow on purpose —
 * nested objects (creator, about, learningResourceType) already use plain
 * keys in AMB.
 *
 * @param {Record<string, any>} amb
 * @returns {Record<string, any>}
 */
function normalizeJsonLdKeys(amb) {
  /** @type {Record<string, any>} */
  const out = { ...amb };
  if (out['@type'] !== undefined && out.type === undefined) out.type = out['@type'];
  if (out['@id'] !== undefined && out.id === undefined) out.id = out['@id'];
  return out;
}

/**
 * Convert AMB JSON-LD fetched from a page into a kind 30142 event object
 * compatible with the `getAMB*` helpers (read-only; no signing).
 *
 * Returns `null` if the input is not a usable AMB resource (missing required
 * fields, malformed, etc.). Callers should treat `null` as "silently proceed
 * with empty form" per the plan.
 *
 * @param {unknown} amb - raw AMB JSON-LD object from the page
 * @returns {{kind: 30142, tags: string[][], content: string, created_at: number, pubkey: string} | null}
 */
export function ambJsonLdToPrefillEvent(amb) {
  if (!amb || typeof amb !== 'object') return null;
  const normalized = normalizeJsonLdKeys(/** @type {Record<string, any>} */ (amb));
  if (!normalized.id || !normalized.name) return null;

  const result = ambToNostr(/** @type {any} */ (normalized));
  if (!result.success || !result.data) return null;
  return /** @type {any} */ (result.data);
}

/**
 * @typedef {Object} OgLikeInput
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [image]
 * @property {string} [locale]
 */

/**
 * Map Open Graph metadata to the AMB wizard's form data shape.
 * Only emits keys that are present — absent fields are omitted rather than
 * set to empty strings, so the form's existing defaults win.
 *
 * Locale normalization: `og:locale` uses BCP-47-ish forms like `de_DE`,
 * `de-AT`, or plain `de`. The form stores ISO 639-1 codes, so we take the
 * primary subtag.
 *
 * @param {OgLikeInput} og
 * @returns {{name?: string, description?: string, image?: string, inLanguage?: string}}
 */
export function ogToFormDataPrefill(og) {
  /** @type {{name?: string, description?: string, image?: string, inLanguage?: string}} */
  const out = {};
  if (!og) return out;
  if (og.title) out.name = og.title;
  if (og.description) out.description = og.description;
  if (og.image) out.image = og.image;
  if (og.locale) out.inLanguage = og.locale.split(/[-_]/)[0];
  return out;
}
