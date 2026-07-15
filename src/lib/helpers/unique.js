/**
 * Dedupe helpers for keyed {#each} blocks.
 *
 * Values extracted from Nostr event tags are untrusted network input — a
 * malformed event can repeat any tag, and a duplicate key in a keyed
 * {#each} crashes the whole page (svelte.dev/e/each_key_duplicate).
 * Run tag-derived arrays through these before they feed a keyed block.
 *
 * Kept dependency-free so it's safe to import anywhere (node tests, jsdom).
 */

/**
 * Remove duplicate values, preserving first-seen order.
 * Always returns a fresh array (safe for $derived).
 *
 * @template T
 * @param {T[] | null | undefined} items
 * @returns {T[]}
 */
export function unique(items) {
  return items ? [...new Set(items)] : [];
}

/**
 * Remove items whose key was already seen, preserving first-seen order.
 *
 * @template T
 * @param {T[] | null | undefined} items
 * @param {(item: T) => unknown} keyFn
 * @returns {T[]}
 */
export function uniqueBy(items, keyFn) {
  if (!items) return [];
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
