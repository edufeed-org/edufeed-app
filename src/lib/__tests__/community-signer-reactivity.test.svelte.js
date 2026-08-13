/**
 * Manager-reactivity bridge (Plan 5 Task 11) — the consumer side, against
 * the REAL accounts.svelte.js module (no vi.mock of it at all — a mocked
 * `manager`/`accountsMeta` stand-in would only prove the mock reacts, not
 * that the real bridge does; see accounts-version-bridge.test.js's comment
 * on why the earlier `manager.accountsVersion` design was a placebo).
 *
 * Runs under jsdom. `$derived.by`/`flushSync()` alone are environment-
 * agnostic (per accounts-version-bridge.test.js), but a plain `$effect`
 * body inside `$effect.root` was empirically observed to never fire when
 * this file's vitest-environment pragma resolved to Node instead — jsdom
 * is required for $effect to actually flush here, matching the existing
 * jsdom precedent in image-license-hook.test.svelte.js. (NOTE for anyone
 * editing this comment: keep exactly one "vitest dash environment" pragma
 * line in this file, at the very end of this block — a second one earlier
 * in the prose gets picked up INSTEAD of the real one below and silently
 * changes which environment the file runs under.)
 *
 * Running under jsdom means `initializeAccountPersistence()` (module init,
 * gated on `typeof window`) runs its window branch too — localStorage
 * read/writes and a cascade of dynamic imports (nostr-infrastructure,
 * relay services, etc.) fire in the background. `manager.addAccount(...)`
 * only pushes to `accounts$` (not `active$`), so none of that cascade
 * depends on our fixture; the one touch point (`manager.toJSON()` in the
 * accounts$ persistence subscription calling `.toJSON()` on our plain
 * fixture object) is caught and console.error'd internally by
 * accounts.svelte.js, not thrown — harmless noise, not a test failure.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import { manager } from '$lib/stores/accounts.svelte.js';
import { isCommunityOwner } from '$lib/helpers/community-signer.js';

describe('isCommunityOwner reactivity (real accounts.svelte.js + real AccountManager)', () => {
  it('a $derived.by consumer recomputes when the manager gains the community key mid-session', () => {
    const PK = 'a'.repeat(64);
    const SIGNER = { signEvent: () => {} };

    /** @type {boolean | undefined} */
    let observed;
    const cleanup = $effect.root(() => {
      const owner = $derived.by(() => isCommunityOwner(PK));
      $effect(() => {
        observed = owner;
      });
    });

    flushSync();
    expect(observed).toBe(false);

    // Simulate the manager gaining the community key mid-session (e.g. the
    // user importing the community account) via the real, public
    // AccountManager API — not a mock, not a raw BehaviorSubject poke.
    // Minimal fixture, not a full IAccount — addAccount/getAccountForPubkey
    // only touch `id`/`pubkey`/`signer` (see applesauce-accounts/dist/manager.js).
    manager.addAccount(
      /** @type {any} */ ({ id: 'reactivity-test-account', pubkey: PK, signer: SIGNER })
    );
    flushSync();

    expect(observed).toBe(true);
    cleanup();
  });
});
