/** @vitest-environment node */
/**
 * reconcile-ledger.js — the persisted "already attempted" memory of the
 * roster reconcile. Without it the hook re-derives the same put-user plan on
 * every page load from a roster the relay refuses to update, and a NIP-46
 * user is asked to sign the same kind-9000s again and again (laoc, 2026-09-15).
 */
import { describe, it, expect } from 'vitest';
import {
  LEDGER_TTL_MS,
  ledgerItemKey,
  readLedger,
  recordLedger,
  withoutLedgered
} from '$lib/groups/reconcile-ledger.js';

const ACCOUNT = 'a'.repeat(64);
const PUBKEY = 'b'.repeat(64);
const POINTER = { id: 'chan1', relay: 'wss://groups.example/' };

/** In-memory stand-in for localStorage. */
function fakeStorage() {
  /** @type {Record<string, string>} */
  const data = {};
  return {
    getItem: (/** @type {string} */ k) => (k in data ? data[k] : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => {
      data[k] = String(v);
    },
    removeItem: (/** @type {string} */ k) => {
      delete data[k];
    },
    data
  };
}

describe('ledgerItemKey', () => {
  it('is stable across role order and case', () => {
    expect(ledgerItemKey(POINTER, PUBKEY, ['Admin', 'moderator'])).toBe(
      ledgerItemKey(POINTER, PUBKEY, ['moderator', 'admin'])
    );
  });

  it('distinguishes a grant from a demotion of the same pubkey', () => {
    expect(ledgerItemKey(POINTER, PUBKEY, ['admin'])).not.toBe(ledgerItemKey(POINTER, PUBKEY, []));
  });

  it('distinguishes channels', () => {
    expect(ledgerItemKey(POINTER, PUBKEY, [])).not.toBe(
      ledgerItemKey({ ...POINTER, id: 'chan2' }, PUBKEY, [])
    );
  });
});

describe('readLedger / recordLedger', () => {
  it('round-trips recorded keys per account', () => {
    const storage = fakeStorage();
    const now = 1_000_000;
    recordLedger(ACCOUNT, ['k1', 'k2'], now, storage);
    expect([...readLedger(ACCOUNT, now, storage).keys()].sort()).toEqual(['k1', 'k2']);
    expect(readLedger('c'.repeat(64), now, storage).size).toBe(0);
  });

  it('merges new keys into an existing ledger', () => {
    const storage = fakeStorage();
    recordLedger(ACCOUNT, ['k1'], 10, storage);
    recordLedger(ACCOUNT, ['k2'], 20, storage);
    const ledger = readLedger(ACCOUNT, 30, storage);
    expect(ledger.get('k1')).toBe(10);
    expect(ledger.get('k2')).toBe(20);
  });

  it('forgets entries older than the TTL so a real regression is retried eventually', () => {
    const storage = fakeStorage();
    recordLedger(ACCOUNT, ['old'], 0, storage);
    recordLedger(ACCOUNT, ['fresh'], LEDGER_TTL_MS, storage);
    const ledger = readLedger(ACCOUNT, LEDGER_TTL_MS + 1, storage);
    expect(ledger.has('old')).toBe(false);
    expect(ledger.has('fresh')).toBe(true);
    // the write also pruned the expired entry
    recordLedger(ACCOUNT, [], LEDGER_TTL_MS + 1, storage);
    expect(JSON.parse(storage.data[Object.keys(storage.data)[0]])).not.toHaveProperty('old');
  });

  it('is empty and never throws when storage is unavailable or corrupt', () => {
    expect(readLedger(ACCOUNT, 1, undefined).size).toBe(0);
    expect(() => recordLedger(ACCOUNT, ['k'], 1, undefined)).not.toThrow();
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      }
    };
    expect(readLedger(ACCOUNT, 1, /** @type {any} */ (throwing)).size).toBe(0);
    expect(() => recordLedger(ACCOUNT, ['k'], 1, /** @type {any} */ (throwing))).not.toThrow();
    const corrupt = fakeStorage();
    corrupt.setItem(`edufeed:roster-reconcile:${ACCOUNT}`, '{not json');
    expect(readLedger(ACCOUNT, 1, corrupt).size).toBe(0);
  });
});

describe('withoutLedgered', () => {
  it('drops plan items whose key is in the ledger, keeps the rest in order', () => {
    const plan = [{ k: 'a' }, { k: 'b' }, { k: 'c' }];
    const ledger = new Map([['b', 1]]);
    expect(withoutLedgered(plan, ledger, (item) => item.k)).toEqual([{ k: 'a' }, { k: 'c' }]);
  });
});
