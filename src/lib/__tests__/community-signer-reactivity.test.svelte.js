/**
 * Manager-reactivity bridge (Plan 5 Task 11) — the consumer side.
 *
 * accounts-version-bridge.test.js proves the bump; this proves the payoff:
 * a $derived.by wrapping getCommunitySigner() recomputes when
 * manager.accountsVersion bumps, simulating what accounts.svelte.js's real
 * accounts$/active$ subscription does on a mid-session manager emission
 * (switching accounts, importing/removing one).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

/** @type {Map<string, any>} */
let accounts = new SvelteMap();
let version = $state(0);

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    getAccountForPubkey: (/** @type {string} */ pk) => accounts.get(pk) ?? undefined,
    get accountsVersion() {
      return version;
    }
  }
}));

describe('getCommunitySigner reactivity', () => {
  it('a $derived.by consumer recomputes when manager.accountsVersion bumps', async () => {
    const { getCommunitySigner } = await import('$lib/helpers/community-signer.js');
    const PK = 'a'.repeat(64);
    const SIGNER = { signEvent: () => {} };

    /** @type {any} */
    let observed;
    const cleanup = $effect.root(() => {
      const signer = $derived.by(() => getCommunitySigner(PK));
      $effect(() => {
        observed = signer;
      });
    });

    flushSync();
    expect(observed).toBeNull();

    // Simulate the manager gaining the community key mid-session (e.g. the
    // user importing the community account) — the real bridge would bump
    // manager.accountsVersion via manager.accounts$'s subscription in
    // accounts.svelte.js.
    accounts.set(PK, { signer: SIGNER });
    version++;
    flushSync();

    expect(observed).toBe(SIGNER);
    cleanup();
  });
});
