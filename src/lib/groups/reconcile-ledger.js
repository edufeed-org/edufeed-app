// Persisted memory of what the roster reconcile has already attempted.
//
// useRosterReconcile derives its put-user plan from the rosters the relay
// SERVES. When a relay serves a stale kind-39001 (seen on groups.edufeed.org
// 2026-09-15: demotions accepted on 09-07, admin list still dated 09-02),
// the same items are re-planned on every page load and refused with
// "blocked: all targets are members already" every time — for a NIP-46 user
// that is a signer prompt per item per visit, forever. The module-level
// session ledger in the hook cannot help: it resets on reload.
//
// This ledger lives in localStorage per account and records every item that
// was either published or DEFINITIVELY refused (blocked:/restricted:/…, see
// isDefinitiveRefusal in groups.js). Transient failures are not recorded, so
// an unreachable relay is retried next session. Entries expire after
// LEDGER_TTL_MS so a genuine regression is re-attempted eventually.
//
// Pure module: storage and clock are parameters (defaults: localStorage,
// Date.now) so it is SSR-safe and testable in node.
import { channelKey } from './community-pointer.js';

export const LEDGER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The slice of the Web Storage API the ledger uses — lets tests pass a plain
 * object and keeps the module independent of the DOM lib type.
 * @typedef {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} LedgerStorage
 */

/** @param {string} accountPubkey */
export function storageKeyFor(accountPubkey) {
  return `edufeed:roster-reconcile:${accountPubkey}`;
}

/**
 * Identity of one reconcile item: channel + target + the exact role set the
 * put-user would write (a grant and a demotion of the same pubkey are
 * different items). Roles are normalised so tag order/case cannot fork keys.
 * @param {{id: string, relay: string}} pointer
 * @param {string} pubkey
 * @param {string[]} [roles]
 */
export function ledgerItemKey(pointer, pubkey, roles = []) {
  const normalised = [...roles]
    .map((r) => String(r).toLowerCase())
    .sort()
    .join(',');
  return `${channelKey(pointer)}|${pubkey}|${normalised}`;
}

/** @returns {LedgerStorage | undefined} */
function defaultStorage() {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * @param {string} accountPubkey
 * @param {number} [now]
 * @param {LedgerStorage | undefined} [storage]
 * @returns {Map<string, number>} item key → recorded-at (ms), expired entries dropped
 */
export function readLedger(accountPubkey, now = Date.now(), storage = defaultStorage()) {
  const ledger = new Map();
  if (!storage) return ledger;
  try {
    const raw = storage.getItem(storageKeyFor(accountPubkey));
    if (!raw) return ledger;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return ledger;
    for (const [key, at] of Object.entries(parsed)) {
      if (typeof at === 'number' && now - at <= LEDGER_TTL_MS) ledger.set(key, at);
    }
  } catch {
    // corrupt or inaccessible storage: behave as if nothing was recorded
  }
  return ledger;
}

/**
 * Merge `keys` (recorded at `now`) into the account's ledger, pruning expired
 * entries on the way. Never throws.
 * @param {string} accountPubkey
 * @param {Iterable<string>} keys
 * @param {number} [now]
 * @param {LedgerStorage | undefined} [storage]
 */
export function recordLedger(accountPubkey, keys, now = Date.now(), storage = defaultStorage()) {
  if (!storage) return;
  try {
    const ledger = readLedger(accountPubkey, now, storage);
    for (const key of keys) ledger.set(key, now);
    storage.setItem(storageKeyFor(accountPubkey), JSON.stringify(Object.fromEntries(ledger)));
  } catch {
    // quota / private mode: the session ledger in the hook still applies
  }
}

/**
 * @template T
 * @param {T[]} plan
 * @param {Map<string, number>} ledger
 * @param {(item: T) => string} keyOf
 */
export function withoutLedgered(plan, ledger, keyOf) {
  return plan.filter((item) => !ledger.has(keyOf(item)));
}
