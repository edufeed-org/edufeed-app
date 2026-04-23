/**
 * Pure helpers for the AMB keyword/tag input.
 *
 * Splits an incoming string (typed fragment or pasted blob) into clean
 * keyword tokens and merges them into an existing de-duplicated list.
 */

/**
 * Split a raw input string into trimmed keyword tokens.
 *
 * Separators: comma, newline, carriage return. Whitespace around each token
 * is trimmed; empty tokens are dropped.
 *
 * @param {string} raw
 * @returns {string[]}
 */
export function splitKeywordInput(raw) {
  if (!raw) return [];
  return raw
    .split(/[,\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Merge new tokens into an existing keyword list, preserving order and
 * skipping duplicates (case-sensitive match on trimmed tokens).
 *
 * @param {string[]} existing
 * @param {string[]} additions
 * @returns {string[]}
 */
export function mergeKeywords(existing, additions) {
  const seen = new Set(existing);
  const out = [...existing];
  for (const token of additions) {
    if (!token) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}
