/**
 * NIP-05 lookup + verification helper.
 *
 * Resolves a `name@domain` (or bare-domain shorthand) against the domain's
 * `/.well-known/nostr.json`. Two public faces of one cached lookup:
 *
 *   - resolveNip05(address)         → the pubkey the domain maps the name to
 *     (people search, /p/<address>, the root shortcut route);
 *   - verifyNip05(address, pubkey)  → whether it maps to the pubkey a profile
 *     claims (the "Verifiziert" chip).
 *
 * Successful lookups — including "the domain does not know this name" — are
 * cached in memory per address for the lifetime of the page. Transient
 * CORS / network / JSON failures are *not* cached so they can recover on
 * the next call.
 *
 * @typedef {'verified' | 'mismatch' | 'error'} VerificationResult
 */

/** @type {Map<string, string | null>} address → mapped pubkey (null = unknown name) */
const lookupCache = new Map();

/**
 * Parse a NIP-05 address into `{ name, domain }`.
 * - `alice@edufeed.org` → `{ name: 'alice', domain: 'edufeed.org' }`
 * - `edufeed.org` → `{ name: '_', domain: 'edufeed.org' }` (bare-domain shorthand)
 * - empty / malformed → `null`
 *
 * @param {string} address
 * @returns {{ name: string, domain: string } | null}
 */
export function parseNip05Address(address) {
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

/**
 * Does the term look like a full `name@domain` NIP-05 address (the form
 * people type into a search field or print on a flyer)? Bare domains are
 * excluded here — they are too easy to confuse with an ordinary search word.
 * @param {string} term
 */
export function isNip05Address(term) {
  const parsed = parseNip05Address(term);
  if (!parsed || parsed.name === '_' || !term.includes('@')) return false;
  return /^[a-z0-9._-]+$/.test(parsed.name) && /^[a-z0-9.-]+\.[a-z0-9-]{2,}$/.test(parsed.domain);
}

/**
 * One cached fetch of `/.well-known/nostr.json?name=…`.
 * @param {{ name: string, domain: string }} parsed
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<{ ok: true, pubkey: string | null } | { ok: false }>}
 */
async function lookupNip05(parsed, fetchImpl) {
  const key = `${parsed.name}@${parsed.domain}`;
  if (lookupCache.has(key))
    return { ok: true, pubkey: /** @type {string | null} */ (lookupCache.get(key)) };
  try {
    const url = `https://${parsed.domain}/.well-known/nostr.json?name=${encodeURIComponent(parsed.name)}`;
    const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
    // Don't cache transient HTTP failures.
    if (!res.ok) return { ok: false };
    const body = await res.json();
    const mapped = body?.names?.[parsed.name];
    const pubkey =
      typeof mapped === 'string' && /^[0-9a-f]{64}$/i.test(mapped) ? mapped.toLowerCase() : null;
    lookupCache.set(key, pubkey);
    return { ok: true, pubkey };
  } catch {
    // Network / CORS / JSON parse — don't cache.
    return { ok: false };
  }
}

/**
 * Resolve a NIP-05 address to the pubkey its domain publishes for it.
 * `null` when the domain does not know the name — or could not be reached.
 *
 * @param {string} nip05Address - `name@domain` or bare `domain`
 * @param {typeof fetch} [fetchImpl] - injectable for tests
 * @returns {Promise<string | null>} lowercase hex pubkey
 */
export async function resolveNip05(nip05Address, fetchImpl = fetch) {
  const parsed = parseNip05Address(nip05Address);
  if (!parsed) return null;
  const result = await lookupNip05(parsed, fetchImpl);
  return result.ok ? result.pubkey : null;
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
  const parsed = parseNip05Address(nip05Address);
  if (!parsed || !expectedPubkey) return 'error';
  const result = await lookupNip05(parsed, fetchImpl);
  if (!result.ok) return 'error';
  return result.pubkey === expectedPubkey.toLowerCase() ? 'verified' : 'mismatch';
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
 * Aggregate per-address verification results into a single profile-level
 * trust status: one verified address is enough to call the profile verified;
 * while any address is still resolving we stay pending; a profile whose
 * addresses all failed — or that has none — is unverified.
 *
 * @param {Array<VerificationResult | 'pending'>} results
 * @returns {'verified' | 'pending' | 'unverified'}
 */
export function aggregateNip05Results(results) {
  if (results.includes('verified')) return 'verified';
  if (results.includes('pending')) return 'pending';
  return 'unverified';
}

/**
 * Test helper — clears the in-memory cache. Not exported as part of the
 * public API; only used by Vitest.
 */
export function _clearNip05Cache() {
  lookupCache.clear();
}
