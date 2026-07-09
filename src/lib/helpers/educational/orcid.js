/**
 * ORCID iD validation and normalization.
 *
 * An ORCID iD is a 16-character identifier (digits, last char may be `X`)
 * displayed as four hyphen-separated groups and canonically expressed as an
 * https URI: `https://orcid.org/0000-0002-1825-0097`.
 *
 * @see https://support.orcid.org/hc/en-us/articles/360006897674
 */

export const ORCID_URI_PREFIX = 'https://orcid.org/';

/**
 * Extract the 16 base characters from any accepted input form
 * (bare id, hyphenless digits, http/https URI, optional www / trailing slash).
 *
 * @param {unknown} input
 * @returns {string | null} uppercase 16-char string or null
 */
function extractBaseChars(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\/(www\.)?orcid\.org\//i, '');
  s = s.replace(/\/+$/, '').replace(/-/g, '').toUpperCase();
  return /^\d{15}[\dX]$/.test(s) ? s : null;
}

/**
 * ISO 7064 mod 11-2 check digit over the first 15 digits.
 * @param {string} base - 16-char base string
 * @returns {boolean}
 */
function checksumValid(base) {
  let total = 0;
  for (let i = 0; i < 15; i++) {
    total = (total + Number(base[i])) * 2;
  }
  const result = (12 - (total % 11)) % 11;
  const expected = result === 10 ? 'X' : String(result);
  return base[15] === expected;
}

/**
 * Whether the input is a structurally valid ORCID iD (incl. checksum).
 * @param {unknown} input
 * @returns {boolean}
 */
export function isValidOrcid(input) {
  const base = extractBaseChars(input);
  return base !== null && checksumValid(base);
}

/**
 * Normalize any accepted ORCID input form to the canonical https URI.
 * @param {unknown} input
 * @returns {string | null} `https://orcid.org/XXXX-XXXX-XXXX-XXXX` or null when invalid
 */
export function normalizeOrcid(input) {
  const base = extractBaseChars(input);
  if (base === null || !checksumValid(base)) return null;
  const groups = [base.slice(0, 4), base.slice(4, 8), base.slice(8, 12), base.slice(12, 16)];
  return ORCID_URI_PREFIX + groups.join('-');
}
