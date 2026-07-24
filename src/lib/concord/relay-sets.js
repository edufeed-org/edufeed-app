// Pure relay-set merge logic (Concord follow-up: stock-relay list sync).
// applesauce-core/helpers is the app's normal (non-concord-fork) package —
// safe to import statically, unlike 'applesauce-concord' itself (see
// client.svelte.js's header comment on the @noble/hashes v2 SSR constraint).
import { normalizeURL } from 'applesauce-core/helpers';

/**
 * Merge two relay URL lists into one deduplicated list, preferring `primary`'s
 * order and content: a URL already present in `primary` is dropped from
 * `fallback` even when the two spellings differ only by case or a trailing
 * slash (compared via `normalizeURL`). Neither input is mutated; the
 * returned URLs are the original (un-normalized) strings.
 * @param {string[] | undefined | null} primary
 * @param {string[] | undefined | null} fallback
 * @returns {string[]}
 */
export function mergeRelaySets(primary, fallback) {
  const seen = new Set();
  const out = [];
  for (const url of [...(primary ?? []), ...(fallback ?? [])]) {
    if (!url) continue;
    const key = normalizeURL(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}
