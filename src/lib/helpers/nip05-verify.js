/**
 * NIP-05 verification helper.
 *
 * Resolves a `name@domain` (or bare-domain shorthand) against the domain's
 * `/.well-known/nostr.json` and reports whether it actually maps to the
 * expected pubkey. The result is cached in-memory per (nip05, pubkey) pair
 * for the lifetime of the page so we don't refetch on every render.
 *
 * `error` results are *not* cached — transient CORS / network failures
 * should be allowed to recover on the next call.
 *
 * @typedef {'verified' | 'mismatch' | 'error'} VerificationResult
 */

/** @type {Map<string, VerificationResult>} */
const cache = new Map();

/**
 * Parse a NIP-05 address into `{ name, domain }`.
 * - `alice@edufeed.org` → `{ name: 'alice', domain: 'edufeed.org' }`
 * - `edufeed.org` → `{ name: '_', domain: 'edufeed.org' }` (bare-domain shorthand)
 * - empty / malformed → `null`
 *
 * @param {string} address
 * @returns {{ name: string, domain: string } | null}
 */
function parseAddress(address) {
  if (typeof address !== 'string') return null;
  const trimmed = address.trim().toLowerCase();
  if (!trimmed) return null;
  const at = trimmed.indexOf('@');
  if (at === -1) {
    // Bare domain — only accept if it looks like a domain.
    if (!trimmed.includes('.')) return null;
    return { name: '_', domain: trimmed };
  }
  const name = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!name || !domain.includes('.')) return null;
  return { name, domain };
}

/** @param {string} nip05 @param {string} pubkey */
function cacheKey(nip05, pubkey) {
  return `${nip05.toLowerCase()}#${pubkey}`;
}

/**
 * Verify that a NIP-05 address resolves to the expected pubkey.
 *
 * @param {string} nip05Address - `name@domain` or bare `domain`
 * @param {string} expectedPubkey - lowercase hex pubkey we expect to find
 * @param {typeof fetch} [fetchImpl] - injectable for tests
 * @returns {Promise<VerificationResult>}
 */
export async function verifyNip05(nip05Address, expectedPubkey, fetchImpl = fetch) {
  const parsed = parseAddress(nip05Address);
  if (!parsed || !expectedPubkey) return 'error';

  const key = cacheKey(nip05Address, expectedPubkey);
  const cached = cache.get(key);
  if (cached) return cached;

  /** @type {VerificationResult} */
  let result;
  try {
    const url = `https://${parsed.domain}/.well-known/nostr.json?name=${encodeURIComponent(parsed.name)}`;
    const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      // Don't cache transient HTTP failures.
      return 'error';
    }
    const body = await res.json();
    const mapped = body?.names?.[parsed.name];
    result = mapped === expectedPubkey ? 'verified' : 'mismatch';
  } catch {
    // Network / CORS / JSON parse — don't cache.
    return 'error';
  }

  cache.set(key, result);
  return result;
}

/**
 * Collect all NIP-05 addresses from a kind-0 event: the `nip05` field in the
 * content JSON first (the "primary" address most clients show), followed by
 * any repeated `["nip05", <address>]` event tags — a wild-but-real pattern
 * for profiles with multiple identifiers. Deduped case-insensitively.
 *
 * @param {{ content?: string, tags?: string[][] } | null | undefined} event - kind-0 event
 * @returns {string[]}
 */
export function getProfileNip05s(event) {
  if (!event) return [];

  /** @type {string[]} */
  const result = [];
  const seen = new Set();

  /** @param {unknown} value */
  const push = (value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(trimmed);
  };

  try {
    push(JSON.parse(event.content || '{}')?.nip05);
  } catch {
    // Malformed content — fall through to tags.
  }
  for (const tag of event.tags || []) {
    if (tag?.[0] === 'nip05') push(tag[1]);
  }
  return result;
}

/**
 * Test helper — clears the in-memory cache. Not exported as part of the
 * public API; only used by Vitest.
 */
export function _clearNip05Cache() {
  cache.clear();
}
