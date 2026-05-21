// @ts-nocheck
/* eslint-disable no-undef -- $state/$effect are Svelte runes, available in .svelte.js context */
/**
 * Regression test for the edit-mode prefill effect loop in
 * `ResourceFormWizard.svelte`.
 *
 * Bug pattern
 * -----------
 * The wizard prefills `formData` from an `editEvent` via an `$effect` that
 * calls an async function `prefillEditData()`. The function's only `await`
 * happens inside a loop over `["p", <pubkey>, "", "creator"]` tags — when the
 * resource has no such tags (common for EKW imports), no await is reached
 * before the function's synchronous `formData = { ...formData, ... }` writes.
 *
 * Because the synchronous portion of an async function is tracked by the
 * surrounding `$effect`, those `{ ...formData, ... }` spread-reads + assignment
 * make the effect read and write the same `$state` in one tracked run.
 * Svelte 5 detects this as `effect_update_depth_exceeded` and the form fails
 * to load.
 *
 * Fix
 * ---
 * Guard the effect with a one-shot `didPrefillEdit` flag so prefill runs once.
 * The wizard re-mounts when the user navigates to a different edit naddr, so
 * `editEvent` never changes after first hydration — the one-shot is safe.
 *
 * This test reproduces the wizard's effect pattern in isolation using
 * `$effect.root` to avoid the cost of mounting the full wizard (which has
 * ~30 dependencies and is documented as impractical to mount in jsdom by
 * `ResourceFormWizard.ekw-step4.test.js`). It locks in the guard contract:
 *  - With the guard: prefill runs once, no effect_update_depth_exceeded.
 *  - Without the guard: the same pattern triggers the loop (sanity check
 *    proving the test is meaningful).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';

/**
 * Build an editEvent shape that matches the wizard's expectations but
 * carries NO `["p", <pubkey>, "", "creator"]` tags. This is the trigger
 * for the bug — see file header.
 */
function makeEditEventWithoutCreatorPTags() {
  return {
    kind: 30142,
    pubkey: 'ekkw'.repeat(16),
    tags: [
      ['d', 'some-resource-id'],
      ['name', 'Test Resource'],
      ['description', 'A resource without creator p-tags'],
      ['identifier', 'https://example.com/resource']
      // intentionally no ["p", ..., "", "creator"]
    ],
    content: '',
    created_at: 1700000000,
    id: 'evt'.repeat(16),
    sig: 'sig'.repeat(16)
  };
}

/**
 * Reproduce the wizard's prefill effect pattern in isolation.
 *
 * Mirrors `ResourceFormWizard.svelte`:
 *   - `formData` is a `$state` object that the effect spreads + writes.
 *   - `prefillEditData()` is `async` but takes no `await` path when the
 *     event has no creator p-tags (the `for (const pubkey of creatorPubkeys)`
 *     loop body never runs).
 *   - The effect calls `prefillEditData()` synchronously.
 *
 * @param {object} opts
 * @param {boolean} opts.guarded — when true, applies the one-shot guard fix.
 * @param {object} opts.editEvent
 * @returns {{ cleanup: () => void, runs: number, getFormData: () => any }}
 */
function runPrefillPattern({ guarded, editEvent }) {
  /** @type {any} */
  let formData = $state({
    name: '',
    description: '',
    identifier: '',
    creators: []
  });

  let runs = 0;
  let didPrefillEdit = false;

  async function prefillEditData() {
    runs++;

    // Mirror the wizard: collect creator pubkeys from p-tags. When empty,
    // the loop below is a no-op and no `await` runs before the sync writes.
    const creatorPubkeys =
      editEvent.tags
        ?.filter((/** @type {string[]} */ t) => t[0] === 'p' && t[3] === 'creator')
        .map((/** @type {string[]} */ t) => t[1]) || [];

    /** @type {any[]} */
    const editCreators = [];
    for (const pubkey of creatorPubkeys) {
      // Simulate the wizard's `await fetchProfileData(pubkey)`.
      // For events without creator p-tags this loop body never runs.
      const profile = await Promise.resolve({ name: 'mock' });
      editCreators.push({ name: profile.name, type: 'Person', pubkey });
    }

    // The synchronous read+write that closes the loop without the guard.
    formData = {
      ...formData,
      name: editEvent.tags.find((/** @type {string[]} */ t) => t[0] === 'name')?.[1] ?? '',
      description:
        editEvent.tags.find((/** @type {string[]} */ t) => t[0] === 'description')?.[1] ?? '',
      identifier:
        editEvent.tags.find((/** @type {string[]} */ t) => t[0] === 'identifier')?.[1] ?? '',
      creators: editCreators
    };
  }

  const cleanup = $effect.root(() => {
    $effect(() => {
      if (guarded) {
        if (didPrefillEdit) return;
        if (editEvent) {
          didPrefillEdit = true;
          prefillEditData();
        }
      } else {
        // Unguarded — the pre-fix code path. Should loop.
        if (editEvent) {
          prefillEditData();
        }
      }
    });
  });

  return {
    cleanup,
    get runs() {
      return runs;
    },
    getFormData: () => formData
  };
}

describe('ResourceFormWizard edit-mode prefill effect', () => {
  /** @type {ReturnType<typeof vi.spyOn>} */
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  /**
   * Collect any Svelte runtime errors logged via console.error during the
   * test interaction. Svelte logs `effect_update_depth_exceeded` (and
   * related) to console.error before throwing.
   */
  function getSvelteRuntimeErrors() {
    /** @type {string[]} */
    const errors = consoleErrorSpy.mock.calls.map((/** @type {unknown[]} */ args) =>
      args.map((a) => String(a)).join(' ')
    );
    return errors.filter((line) =>
      /effect_update_depth|state_unsafe_mutation|effect_orphan/.test(line)
    );
  }

  it('with the guard: prefill runs once and does not trigger effect_update_depth_exceeded', () => {
    const editEvent = makeEditEventWithoutCreatorPTags();

    const harness = runPrefillPattern({ guarded: true, editEvent });
    flushSync();

    expect(getSvelteRuntimeErrors()).toEqual([]);
    expect(harness.runs).toBe(1);

    // Prefill actually populated the form.
    const fd = harness.getFormData();
    expect(fd.name).toBe('Test Resource');
    expect(fd.identifier).toBe('https://example.com/resource');

    harness.cleanup();
  });

  it('without the guard: same event triggers effect_update_depth_exceeded (proves the test is meaningful)', () => {
    const editEvent = makeEditEventWithoutCreatorPTags();

    // Without the guard, Svelte should either throw or log
    // effect_update_depth_exceeded. Either is acceptable evidence that the
    // bug exists and that the guard is load-bearing.
    let threw = false;
    try {
      const harness = runPrefillPattern({ guarded: false, editEvent });
      flushSync();
      harness.cleanup();
    } catch {
      threw = true;
    }

    const loopErrors = getSvelteRuntimeErrors();
    expect(threw || loopErrors.length > 0).toBe(true);
  });
});
