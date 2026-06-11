/**
 * Pure helpers for the typographic cover.
 *
 * Kept in its own module with zero imports so the helpers are
 * trivially testable in a node environment and have no chance of
 * pulling Svelte runes into a non-component context.
 */

/** Titles longer than this (in either words or characters) drop the
 *  script-word treatment and render as a plain headline. The mockup's
 *  playful split only reads well for short titles. */
const SHORT_TITLE_MAX_WORDS = 6;
const SHORT_TITLE_MAX_CHARS = 50;

/**
 * Decide which layout a title should use.
 *
 * @param {string | null | undefined} title
 * @returns {'short' | 'long'}
 */
export function titleLayout(title) {
  const s = (title ?? '').trim();
  if (!s) return 'short';
  const wordCount = s.split(/\s+/).filter(Boolean).length;
  if (wordCount > SHORT_TITLE_MAX_WORDS) return 'long';
  if (s.length > SHORT_TITLE_MAX_CHARS) return 'long';
  return 'short';
}

/**
 * Split a short title into three parts for the cover's title stack:
 * leading words, one highlighted (script) word, trailing words.
 *
 * The highlighted word is at `Math.floor(n / 2)` of the word list.
 * Accepted tradeoff: longer titles can highlight a preposition or
 * article ("für", "und", "der"). The mockup's "Morgen / bestimme /
 * ich" pattern is the canonical case.
 *
 * Only meaningful for titles where `titleLayout(title) === 'short'`.
 * Callers should branch on the layout and use this only for short
 * titles; long titles render as a plain headline instead.
 *
 * @param {string | null | undefined} title
 * @returns {{ leading: string[], script: string, trailing: string[] }}
 */
export function splitTitle(title) {
  const words = (title ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { leading: [], script: '', trailing: [] };
  if (words.length === 1) return { leading: [], script: words[0], trailing: [] };
  const scriptIdx = Math.floor(words.length / 2);
  return {
    leading: words.slice(0, scriptIdx),
    script: words[scriptIdx],
    trailing: words.slice(scriptIdx + 1)
  };
}

/**
 * Derive a hue in [0, 360) from any string per the `string-color` Nostr
 * wiki spec (kind 30818 d-tag "string-color", author 660d8c78…).
 *
 *   number = Σ ( charCode(i) × 256^i )  for i in [0, len)
 *   hue    = number mod 360
 *
 * Input is normalized via trim + toUpperCase per spec. Empty / null
 * input returns null so the caller can render a neutral grey.
 *
 * BigInt arithmetic prevents integer overflow for long inputs.
 *
 * @param {string | null | undefined} input
 * @returns {number | null}
 */
export function stringColorHue(input) {
  const s = (input ?? '').trim().toUpperCase();
  if (!s) return null;
  let n = 0n;
  for (let i = 0; i < s.length; i++) {
    n += BigInt(s.charCodeAt(i)) * 256n ** BigInt(i);
  }
  return Number(n % 360n);
}
