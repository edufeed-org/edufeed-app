/**
 * Deterministic split of content pages into a treatment group (T: server-side
 * crawlable content) and a control group (V: OG tags only) for the GEO
 * experiment. Stateless: the analysis script recomputes the same groups from
 * the same key, share and salt.
 */
import { createHash } from 'node:crypto';

export const DEFAULT_GEO_SALT = 'edufeed-geo-2026';

/**
 * Wiki articles are keyed by topic so /wiki/<topic> and the article's naddr
 * page always land in the same group.
 * @param {{ kind: number, pubkey: string, id?: string, tags?: string[][] }} event
 * @returns {string}
 */
export function geoContentKey(event) {
  const d = event.tags?.find((t) => t[0] === 'd')?.[1] ?? '';
  if (event.kind === 30818) return `wiki:${d}`;
  if (event.kind >= 30000 && event.kind < 40000) return `${event.kind}:${event.pubkey}:${d}`;
  return event.id ?? '';
}

/**
 * @param {string} key
 * @param {number} share - fraction of keys in T, 0…1
 * @param {string} [salt]
 * @returns {'T' | 'V'}
 */
export function geoGroup(key, share, salt = DEFAULT_GEO_SALT) {
  if (share >= 1) return 'T';
  if (share <= 0) return 'V';
  const firstByte = createHash('sha256').update(`${salt}:${key}`).digest()[0];
  return firstByte < share * 256 ? 'T' : 'V';
}

/**
 * GEO_SERVER_CONTENT_SHARE: unset or invalid → 1, so deployments that never
 * run the experiment serve crawlable content on every page.
 * @param {string | undefined} value
 * @returns {number}
 */
export function parseShare(value) {
  if (value === undefined || value === null || String(value).trim() === '') return 1;
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}
