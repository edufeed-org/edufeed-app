/**
 * Locale-aware date formatting helpers.
 *
 * `Date.prototype.toLocaleDateString()` with no locale argument falls back to
 * the runtime locale, which in many dev/CI environments is `en-US` — so users
 * see `6/3/2026` regardless of UI language. These helpers route through the
 * paraglide locale and always pick a European variant (en-GB, not en-US).
 */
import { getLocale } from '$lib/paraglide/runtime.js';

/** @type {Record<string, string>} */
const LOCALE_MAP = {
  en: 'en-GB',
  de: 'de-DE'
};

const FALLBACK_LOCALE = 'de-DE';

/**
 * @returns {string} A BCP-47 locale tag for European date formatting.
 */
function activeDateLocale() {
  try {
    const tag = getLocale();
    return LOCALE_MAP[tag] || FALLBACK_LOCALE;
  } catch {
    return FALLBACK_LOCALE;
  }
}

/**
 * Format a Date as a short date string in the active European locale
 * (en-GB → DD/MM/YYYY, de-DE → DD.MM.YYYY).
 *
 * @param {Date} date
 * @param {Intl.DateTimeFormatOptions} [options]
 * @returns {string}
 */
export function formatDate(date, options) {
  return date.toLocaleDateString(activeDateLocale(), options);
}

/**
 * Convenience for Nostr-style timestamps (seconds since epoch).
 *
 * @param {number} seconds
 * @param {Intl.DateTimeFormatOptions} [options]
 * @returns {string}
 */
export function formatTimestamp(seconds, options) {
  return formatDate(new Date(seconds * 1000), options);
}
