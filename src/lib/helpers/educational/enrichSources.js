/**
 * Pure helpers for Step-2 multi-source AI enrichment.
 *
 * The wizard can enrich from a single pasted URL or from one-or-more uploaded
 * files. Both collapse to a list of source URLs sent to /api/enrich as one
 * grounded LLM call. These helpers keep the source-set logic testable outside
 * the Svelte component.
 */

/**
 * Stable dedupe key for a source-set: sorted then joined, so re-ordering the
 * same URLs yields the same key. Used to make re-clicking "enrich" a no-op.
 *
 * @param {string[]} urls
 * @returns {string}
 */
export function dedupeKeyFor(urls) {
  return [...urls].sort().join('|');
}

/**
 * Pick the enrichable source URLs out of `formData.encodings`. An encoding's
 * `url` is `''` until its license modal completes the Blossom upload, so we
 * keep only entries that already have a real http(s) URL.
 *
 * @param {Array<{ url?: string }> | null | undefined} encodings
 * @returns {string[]}
 */
export function selectUploadedSourceUrls(encodings) {
  return (encodings ?? []).map((f) => f?.url ?? '').filter((u) => /^https?:\/\//.test(u));
}
