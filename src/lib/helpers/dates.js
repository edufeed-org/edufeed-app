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
export function activeDateLocale() {
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

/**
 * Convert an ISO date (`YYYY-MM-DD`) to the German display form `DD.MM.YYYY`.
 * Returns '' for empty/unparseable input. The leading date portion of a full
 * datetime is accepted (`2018-05-03T...` → `03.05.2018`).
 *
 * @param {string | null | undefined} iso
 * @returns {string}
 */
export function isoToGermanDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? '').trim());
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

/**
 * Parse a German date string (`DD.MM.YYYY`, single-digit day/month tolerated)
 * into an ISO `YYYY-MM-DD` string. Returns '' when the input is incomplete or
 * not a real calendar date (e.g. 31.02.2018), so callers can treat '' as
 * "no valid date yet".
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function germanDateToIso(value) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec((value ?? '').trim());
  if (!m) return '';
  return toValidIso(Number(m[3]), Number(m[2]), Number(m[1]));
}

/**
 * Lenient parser for user-typed date input. Accepts, in German day-first
 * order with `.`, `/` or `-` separators:
 *   - `DD.MM.YYYY` (single-digit day/month tolerated)
 *   - `DD.MM.YY` — 2-digit years pivot at 70: 00–69 → 20xx, 70–99 → 19xx
 * plus pasted ISO `YYYY-MM-DD`. 1- and 3-digit years never parse, so
 * mid-typing input (`15.03.2`, `15.03.202`) doesn't resolve eagerly.
 *
 * Returns ISO `YYYY-MM-DD`, or '' for incomplete / invalid input.
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function parseDateInput(value) {
  const s = (value ?? '').trim();
  if (!s) return '';

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return toValidIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const german = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(s);
  if (!german) return '';
  let year = Number(german[3]);
  if (german[3].length === 2) year += year < 70 ? 2000 : 1900;
  return toValidIso(year, Number(german[2]), Number(german[1]));
}

/**
 * Lenient parser for user-typed 24-hour time input. Accepts `HH:MM` (single
 * digits and a `.` separator tolerated), a bare hour (`13` → `13:00`), and
 * digit-only `HMM`/`HHMM` (`930` → `09:30`). Returns a zero-padded `HH:MM`
 * string — the same shape `<input type="time">` binds — or '' when the input
 * is not a valid time, so callers can treat '' as "no valid time yet".
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function parseTimeInput(value) {
  const s = (value ?? '').trim();
  if (!s) return '';

  let hours, minutes;
  const separated = /^(\d{1,2})[:.](\d{2})$/.exec(s);
  const digits = /^(\d{1,2})(\d{2})$/.exec(s);
  const bareHour = /^(\d{1,2})$/.exec(s);
  if (separated) {
    [hours, minutes] = [Number(separated[1]), Number(separated[2])];
  } else if (digits) {
    [hours, minutes] = [Number(digits[1]), Number(digits[2])];
  } else if (bareHour) {
    [hours, minutes] = [Number(bareHour[1]), 0];
  } else {
    return '';
  }

  if (hours > 23 || minutes > 59) return '';
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}`;
}

/**
 * Zero-padded ISO string for a real calendar date, '' otherwise.
 * @param {number} year
 * @param {number} month 1-based
 * @param {number} day
 * @returns {string}
 */
function toValidIso(year, month, day) {
  const dt = new Date(year, month - 1, day);
  // Reject overflow dates (JS rolls 31.02 over into March).
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) {
    return '';
  }
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}
