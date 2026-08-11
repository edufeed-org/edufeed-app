// Stufe-2 membership is OUR client's promise, not the relay's (NIP-29 has no
// cascade — buzz design thread, round 4). These pure functions compute the
// area member union, where each member is missing, and what a fan-out must
// send. Unknown rosters are excluded on both sides: "we have not heard" and
// "not a member" are different sentences (same rule as host-unread).
import { parseGroupPointers, channelKey } from './community-pointer.js';

/** @param {{tags?: string[][]} | null | undefined} communikeyEvent */
export function stufe2Pointers(communikeyEvent) {
  return parseGroupPointers(communikeyEvent).filter((p) => p.access === 'members');
}

/**
 * @param {{pointers: any[], membersByKey: Record<string, Set<string>>}} args
 * @returns {Array<{pubkey: string, inKeys: string[], missingKeys: string[]}>}
 */
export function areaMemberRows({ pointers, membersByKey }) {
  const loadedKeys = pointers
    .map((p) => channelKey(p))
    .filter((key) => key !== null && membersByKey[key] !== undefined);
  /** @type {Map<string, {inKeys: string[], missingKeys: string[]}>} */
  const rows = new Map();
  for (const key of loadedKeys) {
    for (const pubkey of membersByKey[/** @type {string} */ (key)]) {
      if (!rows.has(pubkey)) rows.set(pubkey, { inKeys: [], missingKeys: [] });
    }
  }
  for (const [pubkey, row] of rows) {
    for (const key of loadedKeys) {
      const k = /** @type {string} */ (key);
      if (membersByKey[k].has(pubkey)) row.inKeys.push(k);
      else row.missingKeys.push(k);
    }
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pubkey, row]) => ({ pubkey, ...row }));
}

/**
 * @param {{pubkey: string, pointers: any[], membersByKey: Record<string, Set<string>>}} args
 */
export function fanOutPlan({ pubkey, pointers, membersByKey }) {
  return pointers.filter((p) => {
    const key = channelKey(p);
    if (key === null) return false;
    const roster = membersByKey[key];
    return roster !== undefined && !roster.has(pubkey);
  });
}

/** @param {Array<{key: string, ok: boolean}>} results */
export function aggregateFanOut(results) {
  return {
    ok: results.filter((r) => r.ok).map((r) => r.key),
    failed: results.filter((r) => !r.ok).map((r) => r.key)
  };
}
