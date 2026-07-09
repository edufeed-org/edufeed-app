/**
 * DOI validation and normalization.
 *
 * Canonical stored form is the bare DOI (`10.<registrant>/<suffix>`); the
 * resolver URL form is produced by {@link doiUrl}.
 */

/** Modern Crossref-recommended DOI pattern. */
const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/;

/**
 * Normalize any accepted DOI input form (bare, `doi:` prefix, doi.org URL)
 * to the bare DOI, or return null when invalid.
 *
 * @param {unknown} input
 * @returns {string | null}
 */
export function normalizeDoi(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  s = s.replace(/^doi:/i, '');
  return DOI_PATTERN.test(s) ? s : null;
}

/**
 * Whether the input is a structurally valid DOI in any accepted form.
 * @param {unknown} input
 * @returns {boolean}
 */
export function isValidDoi(input) {
  return normalizeDoi(input) !== null;
}

/**
 * Canonical resolver URL for a bare DOI.
 * @param {string} doi
 * @returns {string}
 */
export function doiUrl(doi) {
  return `https://doi.org/${doi}`;
}
