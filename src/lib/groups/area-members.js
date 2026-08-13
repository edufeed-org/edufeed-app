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
 * Whether a pubkey is present in a channel — explicitly (39002 membersByKey)
 * or implicitly (39001 adminsByKey: NIP-29 counts privileged roles as
 * members, the same rule root-roster.js already applies to the ROOT group;
 * handoff #11d). An admin who never got an explicit 39002 entry in their own
 * channel is not a deviation, just an implicit member.
 * @param {string} key
 * @param {string} pubkey
 * @param {Record<string, Set<string>>} membersByKey
 * @param {Record<string, import('applesauce-common/helpers/groups').GroupAdmin[]>} adminsByKey
 */
function isPresentIn(key, pubkey, membersByKey, adminsByKey) {
  if (membersByKey[key]?.has(pubkey)) return true;
  return (adminsByKey[key] ?? []).some((admin) => admin.pubkey === pubkey);
}

/**
 * @param {{
 *   pointers: any[],
 *   membersByKey: Record<string, Set<string>>,
 *   adminsByKey?: Record<string, import('applesauce-common/helpers/groups').GroupAdmin[]>
 * }} args
 * @returns {Array<{
 *   pubkey: string,
 *   inKeys: string[],
 *   memberKeys: string[],
 *   adminOnlyKeys: string[],
 *   missingKeys: string[]
 * }>} `inKeys` is `memberKeys ∪ adminOnlyKeys`, in loadedKeys order — kept for
 *   display/gating callers that don't care about the distinction. A REMOVAL
 *   fan-out must use `memberKeys` alone: `kind-9001 remove-user` is a no-op
 *   for a pubkey with no 39002 entry (the relay OKs it, the roster is
 *   unchanged, admin rights on `adminOnlyKeys` survive untouched) — folding
 *   admin-only presence into a single `inKeys` for that purpose would make
 *   "Remove" silently do nothing while implying success (review finding,
 *   handoff #11d follow-up).
 */
export function areaMemberRows({ pointers, membersByKey, adminsByKey = {} }) {
  const loadedKeys = pointers
    .map((p) => channelKey(p))
    .filter((key) => key !== null && membersByKey[key] !== undefined);
  /** @type {Map<string, {inKeys: string[], memberKeys: string[], adminOnlyKeys: string[], missingKeys: string[]}>} */
  const rows = new Map();
  for (const key of loadedKeys) {
    const k = /** @type {string} */ (key);
    for (const pubkey of membersByKey[k]) {
      if (!rows.has(pubkey))
        rows.set(pubkey, { inKeys: [], memberKeys: [], adminOnlyKeys: [], missingKeys: [] });
    }
    // An admin-only presence (39001 with no matching 39002 entry) must still
    // surface as a row — otherwise an implicit member is invisible to the
    // area view entirely, not just excluded from "missing".
    for (const admin of adminsByKey[k] ?? []) {
      if (!rows.has(admin.pubkey))
        rows.set(admin.pubkey, { inKeys: [], memberKeys: [], adminOnlyKeys: [], missingKeys: [] });
    }
  }
  for (const [pubkey, row] of rows) {
    for (const key of loadedKeys) {
      const k = /** @type {string} */ (key);
      if (membersByKey[k]?.has(pubkey)) {
        row.memberKeys.push(k);
        row.inKeys.push(k);
      } else if ((adminsByKey[k] ?? []).some((admin) => admin.pubkey === pubkey)) {
        row.adminOnlyKeys.push(k);
        row.inKeys.push(k);
      } else {
        row.missingKeys.push(k);
      }
    }
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pubkey, row]) => ({ pubkey, ...row }));
}

/**
 * @param {{
 *   pubkey: string,
 *   pointers: any[],
 *   membersByKey: Record<string, Set<string>>,
 *   adminsByKey?: Record<string, import('applesauce-common/helpers/groups').GroupAdmin[]>
 * }} args
 */
export function fanOutPlan({ pubkey, pointers, membersByKey, adminsByKey = {} }) {
  return pointers.filter((p) => {
    const key = channelKey(p);
    if (key === null) return false;
    if (membersByKey[key] === undefined) return false;
    return !isPresentIn(key, pubkey, membersByKey, adminsByKey);
  });
}

/** @param {Array<{key: string, ok: boolean}>} results */
export function aggregateFanOut(results) {
  return {
    ok: results.filter((r) => r.ok).map((r) => r.key),
    failed: results.filter((r) => !r.ok).map((r) => r.key)
  };
}
