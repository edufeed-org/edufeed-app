// A group relay's NIP-11 `self` pubkey — the identity that signs the
// relay's own kind-39000 group-metadata events, per NIP-29's convention for
// cross-client invite links (nostr:naddr…). A plain GET, not applesauce's
// reactive `information$` (relay-information.svelte.js): this is called
// from a click handler (invite-message composition), not a component's
// setup, where hooks are not allowed (see CLAUDE.md "Hooks Cannot Be Called
// from Async Handlers").
import { normalizeURL } from 'applesauce-core/helpers/url';

const TIMEOUT_MS = 5000;

/** @type {Map<string, Promise<string | null>>} */
const cache = new Map();

/** Test seam. */
export function __resetRelaySelfCache() {
  cache.clear();
}

/** wss://host/path -> https://host/path — NIP-11 is served over http(s). */
function toHttpUrl(/** @type {string} */ relayUrl) {
  return relayUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

/**
 * Fetch a relay's NIP-11 `self` pubkey. Null on ANY failure (bad status,
 * network error, timeout, missing/non-string field) — callers treat that as
 * "omit the naddr line", never as an error worth surfacing.
 * @param {string} relayUrl
 * @returns {Promise<string | null>}
 */
export function fetchRelaySelf(relayUrl) {
  const key = normalizeURL(relayUrl);
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
      return typeof doc?.self === 'string' ? doc.self : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();

  cache.set(key, promise);
  return promise;
}
