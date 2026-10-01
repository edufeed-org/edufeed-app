// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const accounts = new Map();
const manager = {
  addAccount: vi.fn((a) => accounts.set(a.pubkey, a)),
  setActive: vi.fn(),
  getAccountForPubkey: (pk) => accounts.get(pk),
  removeAccount: vi.fn((a) =>
    accounts.delete(
      typeof a === 'string' ? [...accounts.values()].find((x) => x.id === a)?.pubkey : a.pubkey
    )
  )
};
vi.mock('$lib/stores/accounts.svelte', () => ({ manager }));
const added = [];
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: (e) => added.push(e) }
}));
const publishEvent = vi.fn(async () => {});
vi.mock('$lib/services/publish-service.js', () => ({ publishEvent: (...a) => publishEvent(...a) }));
vi.mock('$lib/services/relay-list-backfill.js', () => ({
  buildSignedDefaultRelayList: vi.fn(async () => null)
}));

// jsdom's TextEncoder produces Uint8Arrays from a different realm than the
// one @noble/hashes was loaded in, which breaks the REAL signer's signing
// path under jsdom (see SignupModal.test.js for the same workaround). Stub
// the keypair helper with a lightweight fake signer so this test exercises
// guest-account.js's own logic, not that unrelated environment gap.
//
// Defined as a `vi.fn()` (default implementation below) so a single test can
// override it with `mockReturnValueOnce` to hand back a signer whose
// `signEvent` rejects, without disturbing the other tests' happy-path keys.
const GUEST_PUBKEY = 'a'.repeat(64);
const generateSignupKeypair = vi.fn(() => ({
  privateKey: new Uint8Array(32).fill(1),
  publicKey: GUEST_PUBKEY,
  nsec: 'nsec1stub',
  npub: 'npub1stub',
  signer: {
    signEvent: vi.fn(async (event) => ({
      ...event,
      id: 'b'.repeat(64),
      sig: 'c'.repeat(128),
      pubkey: GUEST_PUBKEY
    }))
  }
}));
vi.mock('$lib/helpers/signupKeypair.js', () => ({
  generateSignupKeypair: (...args) => generateSignupKeypair(...args)
}));

const { createGuestAccount, isCallGuest, forgetGuestAccount } = await import(
  '$lib/groups/guest-account.js'
);

beforeEach(() => {
  accounts.clear();
  added.length = 0;
  localStorage.clear();
  vi.clearAllMocks();
});

describe('createGuestAccount', () => {
  it('creates, activates and names a fresh key', async () => {
    const user = await createGuestAccount('  Ada  ');
    expect(user.pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(manager.setActive).toHaveBeenCalled();
    const kind0 = added.find((e) => e.kind === 0);
    expect(JSON.parse(kind0.content)).toEqual({ name: 'Ada' });
    expect(kind0.pubkey).toBe(user.pubkey);
    expect(publishEvent).toHaveBeenCalledWith(kind0);
    expect(localStorage.getItem(`signed-up-here:${user.pubkey}`)).toBe('1');
    expect(isCallGuest(user.pubkey)).toBe(true);
  });
  it('refuses a blank name', async () => {
    await expect(createGuestAccount('   ')).rejects.toThrow('name-required');
    expect(manager.addAccount).not.toHaveBeenCalled();
  });
  it('leaves no trace when signing the kind 0 fails', async () => {
    const brokenPubkey = 'd'.repeat(64);
    generateSignupKeypair.mockReturnValueOnce({
      privateKey: new Uint8Array(32).fill(2),
      publicKey: brokenPubkey,
      nsec: 'nsec1broken',
      npub: 'npub1broken',
      signer: { signEvent: vi.fn(async () => Promise.reject(new Error('sign failed'))) }
    });

    await expect(createGuestAccount('Ada')).rejects.toThrow('sign failed');

    expect(manager.addAccount).not.toHaveBeenCalled();
    expect(manager.setActive).not.toHaveBeenCalled();
    expect(localStorage.getItem(`signed-up-here:${brokenPubkey}`)).toBeNull();
    expect(localStorage.getItem(`call-guest:${brokenPubkey}`)).toBeNull();
    expect(added).toHaveLength(0);
    expect(publishEvent).not.toHaveBeenCalled();
  });
});

describe('forgetGuestAccount', () => {
  it('logs out and clears the flags', async () => {
    const user = await createGuestAccount('Ada');
    forgetGuestAccount(user.pubkey);
    expect(manager.removeAccount).toHaveBeenCalled();
    expect(isCallGuest(user.pubkey)).toBe(false);
    expect(localStorage.getItem(`signed-up-here:${user.pubkey}`)).toBeNull();
  });
});
