/**
 * NIP-50 search-string extensions a relay advertises in its NIP-11 document
 * (`limitation.search_extensions`). Brainstorm's tags relay lists
 * `observer` / `sort` / `filter`; a plain search relay lists nothing and
 * would treat `observer:<hex>` as one more search word, so the profile
 * search loader asks here before appending tokens.
 *
 * One fetch per relay, cached for the page lifetime. Failures resolve to []
 * and are NOT cached, so a relay that was briefly unreachable is probed
 * again on the next search instead of silently losing its ranking for the
 * whole session.
 */

const TIMEOUT_MS = 3000;

/** @type {Map<string, Promise<string[]>>} */
const cache = new Map();

/** @param {string} url */
function cacheKey(url) {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

/** @param {string} url */
function toHttpUrl(url) {
  return url
    .trim()
    .replace(/^ws(s?):\/\//i, 'http$1://')
    .replace(/\/+$/, '');
}

/**
 * @param {string} relayUrl - wss:// relay URL
 * @returns {Promise<string[]>} advertised extension names, [] when unknown
 */
export function getSearchExtensions(relayUrl) {
  const key = cacheKey(relayUrl);
  const hit = cache.get(key);
  if (hit) return hit;

  const promise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(toHttpUrl(relayUrl), {
        headers: { Accept: 'application/nostr+json' },
        signal: controller.signal
      });
      if (!response.ok) return null;
      const doc = await response.json();
      const ext = doc?.limitation?.search_extensions;
      if (!Array.isArray(ext)) return [];
      return ext.filter((e) => typeof e === 'string');
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  })().then((resolved) => {
    if (resolved === null) {
      cache.delete(key);
      return [];
    }
    return resolved;
  });

  cache.set(key, promise);
  return promise;
}
