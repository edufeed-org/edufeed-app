// @ts-nocheck
/**
 * Per-account prediction of the closed Blossom server's upload policy.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';

const grantState = vi.hoisted(() => ({ state: 'none', address: '' }));
const profileState = vi.hoisted(() => ({ subscribers: [] }));
const config = vi.hoisted(() => ({ blossom: { gated: true } }));
const accountState = vi.hoisted(() => ({
  active: { pubkey: 'a'.repeat(64), type: 'nsec' },
  subscribers: [],
  emit(next) {
    accountState.active = next;
    for (const cb of accountState.subscribers) cb(next);
  }
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    get active() {
      return accountState.active;
    },
    active$: {
      subscribe(cb) {
        accountState.subscribers.push(cb);
        cb(accountState.active);
        return {
          unsubscribe: () => {
            accountState.subscribers = accountState.subscribers.filter((s) => s !== cb);
          }
        };
      }
    }
  }
}));
vi.mock('$lib/stores/config.svelte.js', async () => {
  const { writable } = await import('svelte/store');
  return { runtimeConfig: config, configReady: writable(true) };
});
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    replaceable: () => ({
      subscribe(cb) {
        profileState.subscribers.push(cb);
        return {
          unsubscribe: () => {
            profileState.subscribers = profileState.subscribers.filter((s) => s !== cb);
          }
        };
      }
    })
  }
}));
vi.mock('$lib/helpers/nip05-verify.js', () => ({
  getProfileNip05s: (event) => event?.nip05s ?? []
}));

// The grant store must be reactive for the $effect in the host to re-run.
vi.mock('$lib/stores/nip05-ready-alert.svelte.js', async () => {
  const mod = await import('./__fixtures__/reactive-grant.svelte.js');
  return { getHandleGrant: mod.getHandleGrant, initNip05ReadyAlert: () => {}, __set: mod.setGrant };
});

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  flushSync();
}

describe('blossom-eligibility store', () => {
  let fetchSpy;
  let mod;
  let grantMod;

  beforeEach(async () => {
    config.blossom = { gated: true };
    grantState.state = 'none';
    accountState.active = { pubkey: ALICE, type: 'nsec' };
    accountState.subscribers = [];
    profileState.subscribers = [];
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const pubkey = new URL(String(url), 'http://x').searchParams.get('pubkey');
      return new Response(JSON.stringify({ eligible: pubkey === ALICE, gated: true }), {
        status: 200
      });
    });
    mod = await import('../blossom-eligibility.svelte.js');
    grantMod = await import('$lib/stores/nip05-ready-alert.svelte.js');
    grantMod.__set('none');
  });

  afterEach(() => {
    mod.stopBlossomEligibility();
    fetchSpy.mockRestore();
  });

  it('gate off → eligible without a fetch', async () => {
    config.blossom = { gated: false };
    mod.initBlossomEligibility();
    await settle();
    expect(mod.getBlossomEligibility(ALICE)).toBe('eligible');
    expect(mod.isBlossomEligible()).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('gated → one fetch per account, unknown until answered', async () => {
    mod.initBlossomEligibility();
    expect(mod.getBlossomEligibility(ALICE)).toBe('unknown');
    expect(mod.isBlossomEligible(ALICE)).toBe(false);
    await vi.waitFor(() => expect(mod.getBlossomEligibility(ALICE)).toBe('eligible'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe(`/api/blossom/eligible?pubkey=${ALICE}`);
  });

  it('account switch fetches the new pubkey and keeps per-key state', async () => {
    mod.initBlossomEligibility();
    await vi.waitFor(() => expect(mod.getBlossomEligibility(ALICE)).toBe('eligible'));
    accountState.emit({ pubkey: BOB, type: 'nsec' });
    await vi.waitFor(() => expect(mod.getBlossomEligibility(BOB)).toBe('ineligible'));
    expect(mod.getBlossomEligibility()).toBe('ineligible'); // active = bob
    expect(mod.getBlossomEligibility(ALICE)).toBe('eligible');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('a handle grant re-checks with refresh=1', async () => {
    mod.initBlossomEligibility();
    await vi.waitFor(() => expect(mod.getBlossomEligibility(ALICE)).toBe('eligible'));
    await settle();
    grantMod.__set('granted');
    await settle();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(String(fetchSpy.mock.calls[1][0])).toContain('refresh=1');
  });

  it('a changed profile nip05 re-checks once the first profile was seen', async () => {
    mod.initBlossomEligibility();
    await vi.waitFor(() => expect(mod.getBlossomEligibility(ALICE)).toBe('eligible'));
    await settle();
    for (const cb of profileState.subscribers) cb({ nip05s: ['a@x'] });
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    for (const cb of profileState.subscribers) cb({ nip05s: ['a@edufeed.org'] });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });

  it('a failed fetch stays unknown and is retried with backoff', async () => {
    vi.useFakeTimers();
    try {
      fetchSpy.mockRejectedValueOnce(new Error('offline'));
      mod.initBlossomEligibility();
      await settle();
      expect(mod.getBlossomEligibility(ALICE)).toBe('unknown');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(15_000);
      await settle();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(mod.getBlossomEligibility(ALICE)).toBe('eligible');
      await vi.advanceTimersByTimeAsync(600_000);
      expect(fetchSpy).toHaveBeenCalledTimes(2); // settled → no more retries
    } finally {
      vi.useRealTimers();
    }
  });

  it("the server's undetermined answer (eligible: null) keeps unknown and retries", async () => {
    vi.useFakeTimers();
    try {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ eligible: null, gated: true }), { status: 200 })
      );
      mod.initBlossomEligibility();
      await settle();
      expect(mod.getBlossomEligibility(ALICE)).toBe('unknown');
      await vi.advanceTimersByTimeAsync(15_000);
      await settle();
      expect(mod.getBlossomEligibility(ALICE)).toBe('eligible');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after the backoff ladder', async () => {
    vi.useFakeTimers();
    try {
      fetchSpy.mockRejectedValue(new Error('offline'));
      mod.initBlossomEligibility();
      await settle();
      for (const delay of [15_000, 60_000, 300_000, 300_000]) {
        await vi.advanceTimersByTimeAsync(delay);
        await settle();
      }
      expect(fetchSpy).toHaveBeenCalledTimes(4); // initial + 3 retries
      expect(mod.getBlossomEligibility(ALICE)).toBe('unknown');
    } finally {
      vi.useRealTimers();
    }
  });
});
