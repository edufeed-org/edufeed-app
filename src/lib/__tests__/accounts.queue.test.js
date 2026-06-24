/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { ExtensionAccount } from 'applesauce-accounts/accounts';
import { hardenExtensionAccounts, wrapSignerWithTimeout } from '$lib/stores/accounts.svelte.js';

const PK = 'a'.repeat(64); // valid 64-char hex pubkey

/**
 * @param {(t: any) => any} behavior
 * @returns {any}
 */
function makeSigner(behavior) {
  return { getPublicKey: async () => PK, signEvent: (/** @type {any} */ t) => behavior(t) };
}

/**
 * @param {Promise<any>} p
 * @param {number} ms
 * @returns {Promise<'settled' | 'timeout'>}
 */
const withTimeout = (p, ms) =>
  Promise.race([
    p.then(
      () => 'settled',
      () => 'settled'
    ),
    new Promise((res) => setTimeout(() => res('timeout'), ms))
  ]);

describe('wrapSignerWithTimeout', () => {
  it('rejects signEvent that never settles, after the timeout', async () => {
    const signer = makeSigner(() => new Promise(() => {})); // never settles
    const wrapped = wrapSignerWithTimeout(signer, 50);
    await expect(wrapped.signEvent({ kind: 1 })).rejects.toThrow(/timed out/);
  });

  it('passes through a signEvent that resolves in time', async () => {
    const signer = makeSigner(async () => ({ id: 'ok' }));
    const wrapped = wrapSignerWithTimeout(signer, 1000);
    await expect(wrapped.signEvent({ kind: 1 })).resolves.toEqual({ id: 'ok' });
  });

  it('passes getPublicKey and nip04 through untouched', async () => {
    const nip04 = { encrypt: async () => 'enc', decrypt: async () => 'dec' };
    const signer = {
      getPublicKey: async () => PK,
      signEvent: async () => ({}),
      get nip04() {
        return nip04;
      }
    };
    const wrapped = wrapSignerWithTimeout(signer, 1000);
    expect(await wrapped.getPublicKey()).toBe(PK);
    expect(wrapped.nip04).toBe(nip04);
  });
});

describe('hardenExtensionAccounts', () => {
  it('disables the queue and wraps the signer for extension accounts only', () => {
    const extSigner = makeSigner(async () => ({}));
    const ext = { type: 'extension', disableQueue: undefined, signer: extSigner };
    const bunkerSigner = makeSigner(async () => ({}));
    const bunker = { type: 'nostr-connect', disableQueue: undefined, signer: bunkerSigner };

    hardenExtensionAccounts([ext, bunker]);

    expect(ext.disableQueue).toBe(true);
    expect(ext.signer).not.toBe(extSigner); // wrapped
    expect(bunker.disableQueue).toBeUndefined();
    expect(bunker.signer).toBe(bunkerSigner); // untouched
  });

  it('is idempotent: re-running does not re-wrap the signer', () => {
    const ext = {
      type: 'extension',
      disableQueue: undefined,
      signer: makeSigner(async () => ({}))
    };
    hardenExtensionAccounts([ext]);
    const wrappedOnce = ext.signer;
    hardenExtensionAccounts([ext]);
    expect(ext.signer).toBe(wrappedOnce);
  });
});

// Documents the underlying applesauce queue behaviour that the fix guards against:
// a NIP-07 signEvent that never settles (popup dismissed) poisons the shared lock.
describe('account signing queue deadlock (regression guard)', () => {
  it('a hung signEvent blocks all later signing while the queue is enabled', async () => {
    let secondReached = false;
    const acct = new ExtensionAccount(
      PK,
      makeSigner((t) => {
        if (t.content === 'a') return new Promise(() => {}); // never settles
        secondReached = true;
        return Promise.reject(new Error('reached'));
      })
    );
    acct.signEvent({ kind: 1, content: 'a', tags: [], created_at: 0 }).catch(() => {});
    const outcome = await withTimeout(
      acct.signEvent({ kind: 1, content: 'b', tags: [], created_at: 0 }),
      300
    );
    expect(outcome).toBe('timeout');
    expect(secondReached).toBe(false);
  });

  it('disableQueue lets later signing proceed despite a hung request', async () => {
    let secondReached = false;
    const acct = new ExtensionAccount(
      PK,
      makeSigner((t) => {
        if (t.content === 'a') return new Promise(() => {});
        secondReached = true;
        return Promise.reject(new Error('reached'));
      })
    );
    hardenExtensionAccounts([acct]);
    acct.signEvent({ kind: 1, content: 'a', tags: [], created_at: 0 }).catch(() => {});
    const outcome = await withTimeout(
      acct.signEvent({ kind: 1, content: 'b', tags: [], created_at: 0 }),
      300
    );
    expect(outcome).toBe('settled');
    expect(secondReached).toBe(true);
  });
});
