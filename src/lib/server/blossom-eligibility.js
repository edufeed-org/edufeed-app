/**
 * Blossom upload eligibility — the app-side mirror of the Blossom server's
 * closed-upload policy.
 *
 * blossom.edufeed.org only accepts uploads from pubkeys listed in its storage
 * rules (`requirePubkeyInRule`), where a rule's list is a static allowlist
 * plus every pubkey published in the `nostr.json` of configured NIP-05
 * domains. The server enforces; this module only PREDICTS the same answer so
 * the client can pick a sensible upload target, nudge eligible users and
 * never route a non-member at a server that will refuse them. Both sides read
 * the same two inputs, configured here as
 *
 *   BLOSSOM_ELIGIBLE_PUBKEYS        comma list, hex or npub
 *   BLOSSOM_ELIGIBLE_NIP05_DOMAINS  comma list of domains serving the full
 *                                   name→pubkey map without `?name=`
 *
 * Both unset = gate off: everyone is eligible and nothing is fetched, which
 * keeps deployments without a closed server exactly as they were.
 *
 * Lives in $lib/server because a `+server.js` may only export route handlers.
 */
import { env } from '$env/dynamic/private';
import { nip19 } from 'nostr-tools';
import { parseArray } from './env-parse.js';

const HEX64 = /^[0-9a-f]{64}$/;
const NOSTR_JSON_TIMEOUT_MS = 5000;
/** After a failed fetch with no cached copy, don't hammer the domain for this long. */
const FAILURE_RETRY_MS = 30_000;

/**
 * @typedef {{ pubkeys: Set<string>, domains: string[], gated: boolean }} EligibilityConfig
 * @typedef {{
 *   gated: boolean,
 *   config: EligibilityConfig,
 *   isEligible: (pubkey: string, opts?: { refresh?: boolean }) => Promise<boolean | null>
 * }} EligibilityChecker
 *
 * `isEligible` answers `null` ("undetermined") when the pubkey was not found
 * but at least one domain's directory has never been loaded — a definitive
 * "no" there would make the client reroute a member and nudge them off the
 * deployment server over a transient outage.
 */

/**
 * Hex (any case) or npub → lowercase hex, null for anything else.
 * @param {string | null | undefined} input
 * @returns {string | null}
 */
export function normalizePubkey(input) {
  const value = (input || '').trim();
  if (!value) return null;
  if (HEX64.test(value.toLowerCase())) return value.toLowerCase();
  if (value.startsWith('npub1')) {
    try {
      const decoded = nip19.decode(value);
      if (decoded.type === 'npub') return decoded.data;
    } catch {
      /* fall through */
    }
  }
  return null;
}

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeDomain(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}

/**
 * @param {Record<string, string | undefined>} envVars
 * @returns {EligibilityConfig}
 */
export function parseEligibilityConfig(envVars) {
  const pubkeys = new Set();
  for (const entry of parseArray(envVars.BLOSSOM_ELIGIBLE_PUBKEYS)) {
    const hex = normalizePubkey(entry);
    if (hex) pubkeys.add(hex);
    else console.warn(`[blossom-eligibility] dropping invalid BLOSSOM_ELIGIBLE_PUBKEYS entry`);
  }
  const domains = parseArray(envVars.BLOSSOM_ELIGIBLE_NIP05_DOMAINS)
    .map(normalizeDomain)
    .filter(Boolean);
  return { pubkeys, domains, gated: pubkeys.size > 0 || domains.length > 0 };
}

/**
 * Fetch a domain's full NIP-05 map and return the set of pubkeys in it.
 * Throws on network/HTTP/shape errors so the caller can keep its stale copy.
 * @param {string} domain
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<Set<string>>}
 */
async function fetchDomainPubkeys(domain, fetchImpl) {
  const res = await fetchImpl(`https://${domain}/.well-known/nostr.json`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(NOSTR_JSON_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  const names = body && typeof body === 'object' && !Array.isArray(body) ? body.names : null;
  if (!names || typeof names !== 'object' || Array.isArray(names)) {
    throw new Error('nostr.json has no names object');
  }
  const set = new Set();
  for (const value of Object.values(names)) {
    const hex = typeof value === 'string' ? normalizePubkey(value) : null;
    if (hex) set.add(hex);
  }
  return set;
}

/**
 * @param {EligibilityConfig} config
 * @param {{ fetchImpl?: typeof fetch, ttlMs?: number, minRefreshMs?: number, now?: () => number }} [opts]
 * @returns {EligibilityChecker}
 */
export function createEligibilityChecker(config, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const ttlMs = opts.ttlMs ?? 5 * 60_000;
  const minRefreshMs = opts.minRefreshMs ?? 30_000;
  const now = opts.now || Date.now;

  /** @type {Map<string, { pubkeys: Set<string>, fetchedAt: number }>} */
  const cache = new Map();
  /** Last failed attempt per domain — throttles retries while nothing is cached. */
  /** @type {Map<string, number>} */
  const failedAt = new Map();
  /** @type {Map<string, Promise<Set<string> | null>>} */
  const inFlight = new Map();

  /**
   * Current pubkey set for a domain, refreshing when stale. Never throws:
   * a failed refresh keeps the previous set; with no copy at all it yields
   * `null` so the caller can report "undetermined" instead of "no".
   * @param {string} domain
   * @param {boolean} refresh
   * @returns {Promise<Set<string> | null>}
   */
  async function domainPubkeys(domain, refresh) {
    const entry = cache.get(domain);
    const age = entry ? now() - entry.fetchedAt : Infinity;
    const stale = age >= ttlMs || (refresh && age >= minRefreshMs);
    if (entry && !stale) return entry.pubkeys;
    const lastFailure = failedAt.get(domain);
    if (!entry && lastFailure !== undefined && now() - lastFailure < FAILURE_RETRY_MS) {
      return null;
    }

    let pending = inFlight.get(domain);
    if (!pending) {
      pending = fetchDomainPubkeys(domain, fetchImpl)
        .then((pubkeys) => {
          cache.set(domain, { pubkeys, fetchedAt: now() });
          failedAt.delete(domain);
          return pubkeys;
        })
        .catch((err) => {
          failedAt.set(domain, now());
          console.warn(
            `[blossom-eligibility] nostr.json for ${domain} failed (${err?.message || err}); ` +
              (entry ? 'keeping cached copy' : 'no copy yet')
          );
          return null;
        })
        .finally(() => inFlight.delete(domain));
      inFlight.set(domain, pending);
    }
    const fresh = await pending;
    return fresh || entry?.pubkeys || null;
  }

  return {
    gated: config.gated,
    config,
    async isEligible(pubkey, { refresh = false } = {}) {
      if (!config.gated) return true;
      const hex = normalizePubkey(pubkey);
      if (!hex) return false;
      if (config.pubkeys.has(hex)) return true;
      // All domains in parallel: cold-cache latency is the slowest fetch, not the sum.
      const sets = await Promise.all(config.domains.map((d) => domainPubkeys(d, refresh)));
      if (sets.some((set) => set?.has(hex))) return true;
      return sets.every((set) => set !== null) ? false : null;
    }
  };
}

/** @type {EligibilityChecker | undefined} */
let _checker;

/** Lazy singleton over the deployment's env. @returns {EligibilityChecker} */
export function getEligibilityChecker() {
  if (!_checker) _checker = createEligibilityChecker(parseEligibilityConfig(env));
  return _checker;
}

/** The parsed env (once per process — /api/config reads it on every request). */
export function getEligibilityConfig() {
  return getEligibilityChecker().config;
}

/** Test seam. */
export function _resetEligibilityForTests() {
  _checker = undefined;
}
