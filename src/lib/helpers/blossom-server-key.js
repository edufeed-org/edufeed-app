/**
 * Comparison key for Blossom server URLs: case-insensitive, trailing slashes
 * ignored, so `https://blossom.edufeed.org/` (config) and
 * `https://blossom.edufeed.org` (a kind 10063 entry) count as one server.
 * @param {string | null | undefined} url
 * @returns {string}
 */
export function blossomServerKey(url) {
  return (url ?? '').trim().toLowerCase().replace(/\/+$/, '');
}

/**
 * Dedupe a server list by blossomServerKey, keeping first occurrences.
 * @param {Array<string | null | undefined>} urls
 * @returns {string[]}
 */
export function uniqueBlossomServers(urls) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const url of urls) {
    if (!url) continue;
    const key = blossomServerKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}
