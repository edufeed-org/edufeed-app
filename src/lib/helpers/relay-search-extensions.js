/**
 * NIP-50 search-string extensions a relay advertises in its NIP-11 document.
 * Two spellings exist, and the tags relay may move from one to the other:
 *
 *   - `limitation.search_extensions: ["observer", "sort", "filter"]` —
 *     Brainstorm's current strfry + nip50-proxy deployment.
 *   - top-level `nip50: ["ext observer", "ext filter:rank", "query negate"]`
 *     — NosFabrica/vespa-relay (RelayInfo.kt), "<class> <token>" entries.
 *     Only `ext` entries are search-string tokens; the name is the part
 *     before any colon (`ext filter:rank` → `filter`).
 *
 * A plain search relay lists nothing under either key and would treat
 * `observer:<hex>` as one more search word, so the profile search loader
 * asks here before appending tokens. Both lists are unioned, deduped, in
 * document order (`limitation` first).
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
 * Pure: the extension names a NIP-11 document advertises, both spellings
 * unioned. Exported for tests and for anyone holding a document already.
 * @param {any} doc - parsed NIP-11 JSON
 * @returns {string[]}
 */
export function parseSearchExtensions(doc) {
  /** @type {string[]} */
  const names = [];
  const legacy = doc?.limitation?.search_extensions;
  if (Array.isArray(legacy)) {
    for (const e of legacy) if (typeof e === 'string' && e) names.push(e);
  }
  const nip50 = doc?.nip50;
  if (Array.isArray(nip50)) {
    for (const entry of nip50) {
      if (typeof entry !== 'string') continue;
      const [cls, token] = entry.trim().split(/\s+/, 2);
      if (cls !== 'ext' || !token) continue;
      names.push(token.split(':', 1)[0]);
    }
  }
  return [...new Set(names)];
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
      return parseSearchExtensions(doc);
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
