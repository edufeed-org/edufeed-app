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
/** Words longer than this can't fit a cover line even at the minimum font
 *  size the split layout allows — the long-headline layout wraps them
 *  (overflow-wrap: anywhere) instead of clipping. */
const SHORT_TITLE_MAX_WORD_CHARS = 16;

/**
 * Decide which layout a title should use.
 *
 * @param {string | null | undefined} title
 * @returns {'short' | 'long'}
 */
export function titleLayout(title) {
  const s = (title ?? '').trim();
  if (!s) return 'short';
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length > SHORT_TITLE_MAX_WORDS) return 'long';
  if (s.length > SHORT_TITLE_MAX_CHARS) return 'long';
  if (longestWordLength(words) > SHORT_TITLE_MAX_WORD_CHARS) return 'long';
  return 'short';
}

/** Punctuation that gets stripped from the END of the script word so it
 *  doesn't trigger a stranded-character wrap (e.g. "Verantwortung:" → "Verantwortung").
 *  Leading/trailing words keep their punctuation. */
const SCRIPT_TRAILING_PUNCT = /[:;,.!?…]+$/u;

/**
 * Split a short title into three parts for the cover's title stack:
 * leading words, one highlighted (script) word, trailing words.
 *
 * Split happens on whitespace only — never inside a word. Rules:
 * - 0 words → all empty
 * - 1 word → renders plain on the leading line (no script accent)
 * - 2 words → first leading, second script, no trailing
 * - 3+ words → script = longest INNER word (excludes first and last).
 *   Ties broken by first occurrence. Picking the longest content word
 *   avoids highlighting prepositions/articles like "für", "und", "der".
 *
 * Trailing punctuation ([:;,.!?…]) is stripped from the script word so a
 * stranded character doesn't wrap onto its own Caveat-italic line.
 *
 * Only meaningful for titles where `titleLayout(title) === 'short'`.
 * Callers branch on the layout and use this for short titles only.
 *
 * @param {string | null | undefined} title
 * @returns {{ leading: string[], script: string, trailing: string[] }}
 */
export function splitTitle(title) {
  const words = (title ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { leading: [], script: '', trailing: [] };
  if (words.length === 1) return { leading: [words[0]], script: '', trailing: [] };
  if (words.length === 2) {
    return {
      leading: [words[0]],
      script: words[1].replace(SCRIPT_TRAILING_PUNCT, ''),
      trailing: []
    };
  }
  // 3+ words: pick the longest inner word as the script accent.
  let scriptIdx = 1;
  let longest = words[1].length;
  for (let i = 2; i < words.length - 1; i++) {
    if (words[i].length > longest) {
      longest = words[i].length;
      scriptIdx = i;
    }
  }
  return {
    leading: words.slice(0, scriptIdx),
    script: words[scriptIdx].replace(SCRIPT_TRAILING_PUNCT, ''),
    trailing: words.slice(scriptIdx + 1)
  };
}

/**
 * Length of the longest word in a list. Used by the cover to scale the
 * title font down so long German compounds fit instead of being clipped
 * by the card's `overflow: hidden`.
 *
 * @param {string[] | null | undefined} words
 * @returns {number} 0 when the list is empty
 */
export function longestWordLength(words) {
  return (words ?? []).reduce((max, w) => Math.max(max, (w ?? '').length), 0);
}

/**
 * Format a list of authors for the cover attribution line.
 *
 * | count | output                |
 * |-------|-----------------------|
 * |   0   | `null`                |
 * |   1   | full name             |
 * |   2   | `A & B`               |
 * |   3+  | `A, B et al.`         |
 *
 * Order matches the input order (first author = primary). Single names
 * are never abbreviated — the attribution line clamps at 2 full-width
 * lines, which absorbs even long org names.
 *
 * @param {string[]} authors
 * @returns {string | null}
 */
export function formatAuthors(authors) {
  const cleaned = (authors ?? []).map((a) => (a ?? '').trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} & ${cleaned[1]}`;
  return `${cleaned[0]}, ${cleaned[1]} et al.`;
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
