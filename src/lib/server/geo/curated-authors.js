/**
 * Server-side view of the deployment's curated authors (articles + learning
 * resources), used by the indexability rule for pages and sitemap alike.
 * Resolved from the same env config as /api/config (CURATED_PUBKEYS*,
 * kind 30000 sets, WoT anchors when WOT_ENABLED) and cached
 * stale-while-revalidate: an old set is served at once and refreshed in the
 * background, so no page request waits on it after the first resolution.
 */
import { nip19 } from 'nostr-tools';
import { normalizePubkey } from '$lib/helpers/pubkey.js';
import {
  parseArray,
  parseBool,
  resolveCuratedConfig,
  resolveWotConfig
} from '$lib/server/env-parse.js';
import { getRelaysForKind } from '$lib/server/relay-fetch.js';

/** Curation categories whose content the indexability rule covers. */
const CATEGORIES = ['LONGFORM', 'EDUCATIONAL'];

/**
 * @typedef {(filter: import('nostr-tools').Filter, relays: string[], timeoutMs?: number) => Promise<import('nostr-tools').NostrEvent | null>} FetchFirst
 */

/**
 * @param {{ sets: string[], direct: string[] } | null} curated
 * @param {string[]} wotAnchors
 * @param {FetchFirst} fetchFirst
 * @returns {Promise<string[] | null>} null = nothing configured; [] = configured but nobody resolved
 */
export async function resolveAuthors(curated, wotAnchors, fetchFirst) {
  const sets = curated?.sets ?? [];
  const direct = curated?.direct ?? [];
  if (sets.length === 0 && direct.length === 0 && wotAnchors.length === 0) return null;

  /** @type {Set<string>} */
  const authors = new Set();
  for (const value of [...direct, ...wotAnchors]) {
    const hex = normalizePubkey(value);
    if (hex) authors.add(hex);
  }
  const lists = await Promise.all(
    sets.map(async (naddr) => {
      try {
        const decoded = nip19.decode(naddr);
        if (decoded.type !== 'naddr') return null;
        const { kind, pubkey, identifier, relays = [] } = decoded.data;
        return fetchFirst(
          { kinds: [kind], authors: [pubkey], '#d': [identifier], limit: 1 },
          getRelaysForKind(kind, relays)
        );
      } catch {
        return null;
      }
    })
  );
  for (const list of lists) {
    for (const tag of list?.tags ?? []) {
      const hex = tag[0] === 'p' ? normalizePubkey(tag[1]) : null;
      if (hex) authors.add(hex);
    }
  }
  return [...authors];
}

/**
 * Union of the curated authors of all covered categories plus GEO_INDEX_AUTHORS.
 * @param {Record<string, string | undefined>} env
 * @param {FetchFirst} fetchFirst
 * @returns {Promise<Set<string>>}
 */
export async function resolveCuratedAuthorSet(env, fetchFirst) {
  const wot = parseBool(env.WOT_ENABLED, false);
  const lists = await Promise.all(
    CATEGORIES.map((suffix) =>
      resolveAuthors(
        resolveCuratedConfig(env, suffix),
        wot ? resolveWotConfig(env, suffix).anchors : [],
        fetchFirst
      )
    )
  );
  // Deployment accounts indexed without being curated in the app (e.g. the
  // account publishing the user guides).
  const extra = parseArray(env.GEO_INDEX_AUTHORS)
    .map((v) => normalizePubkey(v))
    .filter(/** @returns {hex is string} */ (hex) => !!hex);
  return new Set([...lists.flatMap((l) => l ?? []), ...extra]);
}

/**
 * @param {{ resolve: () => Promise<Set<string>>, ttlMs: number, now?: () => number }} opts
 */
export function createCuratedAuthorsCache({ resolve, ttlMs, now = Date.now }) {
  /** @type {{ authors: Set<string>, at: number } | null} */
  let cached = null;
  /** @type {Promise<Set<string>> | null} */
  let inFlight = null;

  function refresh() {
    inFlight ??= resolve()
      .then((authors) => {
        cached = { authors, at: now() };
        return authors;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  return {
    /**
     * @param {number} maxWaitMs - how long a caller waits when nothing is cached yet
     * @returns {Promise<Set<string> | null>} null while the first resolution is pending/failed
     */
    async get(maxWaitMs) {
      if (cached) {
        if (now() - cached.at > ttlMs) refresh().catch(() => {});
        return cached.authors;
      }
      const pending = refresh().catch(() => null);
      return Promise.race([pending, new Promise((r) => setTimeout(() => r(null), maxWaitMs))]);
    }
  };
}
