/**
 * Manager-reactivity bridge (Plan 5 Task 11): AccountManager exposes cheap
 * `accounts$`/`active$` BehaviorSubjects; accounts.svelte.js subscribes to
 * both once at module init and bumps `accountsMeta.version` — a plain
 * object-literal `$state` export, genuinely proxied by Svelte (unlike
 * `manager`, a class instance, which $state() does NOT proxy — see the
 * comment on `accountsMeta` in accounts.svelte.js) — on every emission, so
 * code that can't sit inside a component's `$effect` (e.g.
 * community-signer.js's $derived.by callers) has something to read for a
 * dependency. This uses the REAL module (not mocked) — importing it in the
 * `node` environment skips `initializeAccountPersistence`'s window-gated
 * localStorage/relay side effects (see accounts.svelte.js: "Only run on
 * client side"), so only the manager + the bridge run, which is exactly
 * what this test wants to exercise.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { manager, accountsMeta } from '$lib/stores/accounts.svelte.js';

describe('accountsMeta.version bridge', () => {
  it('bumps when manager.accounts$ emits', () => {
    const before = accountsMeta.version;
    manager.accounts$.next([...manager.accounts$.value]);
    expect(accountsMeta.version).toBeGreaterThan(before);
  });

  it('bumps when manager.active$ emits', () => {
    const before = accountsMeta.version;
    manager.active$.next(manager.active$.value);
    expect(accountsMeta.version).toBeGreaterThan(before);
  });
});
