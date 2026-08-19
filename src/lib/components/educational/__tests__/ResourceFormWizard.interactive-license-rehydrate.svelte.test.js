// @ts-nocheck
/* eslint-disable no-undef -- $state/$effect are Svelte runes, available in .svelte.js context */
/**
 * Regression test for the interactive-package license rehydration effect in
 * `ResourceFormWizard.svelte`.
 *
 * Bug pattern
 * -----------
 * Edit-mode prefill seeds `interactivePackage.licenseEvent = null` (the
 * kind-1063 license/discovery event for the package isn't embedded in the
 * kind-30142 edit event — it lives on the network, keyed by the package's
 * SHA-256). Without a rehydration step, step-2/step-5 validation see a
 * licenseEvent-less encoding forever, even though the attestation exists.
 *
 * Fix
 * ---
 * Mirror the existing image-license rehydration pattern (`editImageHash` +
 * `useLicenseForHash`, ResourceFormWizard.svelte ~430-444): subscribe on the
 * package's sha256, and fill `interactivePackage.licenseEvent` once the 1063
 * arrives — but only when the package doesn't already carry one (so a
 * license the user just picked in this session, or one already rehydrated,
 * is never clobbered).
 *
 * This test reproduces the effect in isolation via `$effect.root`, the same
 * technique `ResourceFormWizard.edit-prefill.svelte.test.js` uses because
 * mounting the full wizard in jsdom is impractical (~30 dependencies).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';

/**
 * Reproduce the wizard's interactive-package rehydration effect in
 * isolation.
 *
 * @param {object} opts
 * @param {{ sha256: string, licenseEvent: any } | null} opts.initialPackage
 * @param {(hash: string | null) => any} opts.lookupLicense - stands in for
 *   `useLicenseForHash`'s returned getter.
 * @returns {{ cleanup: () => void, getPackage: () => any }}
 */
function runRehydratePattern({ initialPackage, lookupLicense }) {
  /** @type {any} */
  let interactivePackage = $state(initialPackage);

  const cleanup = $effect.root(() => {
    const editInteractiveHash = $derived(interactivePackage?.sha256 ?? null);

    $effect(() => {
      const hash = editInteractiveHash;
      if (hash && interactivePackage && !interactivePackage.licenseEvent) {
        const lic = lookupLicense(hash);
        if (lic) interactivePackage = { ...interactivePackage, licenseEvent: lic };
      }
    });
  });

  return {
    cleanup,
    getPackage: () => interactivePackage
  };
}

describe('ResourceFormWizard interactive-package license rehydration', () => {
  it('fills licenseEvent from the network once it resolves', () => {
    const licenseEvent = { id: 'lic1', kind: 1063 };
    const harness = runRehydratePattern({
      initialPackage: { sha256: 'aa', name: 'Quiz', licenseEvent: null },
      lookupLicense: (hash) => (hash === 'aa' ? licenseEvent : null)
    });
    flushSync();

    expect(harness.getPackage().licenseEvent).toEqual(licenseEvent);
    harness.cleanup();
  });

  it('does not overwrite a licenseEvent the package already carries', () => {
    const existing = { id: 'already-set', kind: 1063 };
    const harness = runRehydratePattern({
      initialPackage: { sha256: 'aa', name: 'Quiz', licenseEvent: existing },
      lookupLicense: () => ({ id: 'from-network', kind: 1063 })
    });
    flushSync();

    expect(harness.getPackage().licenseEvent).toEqual(existing);
    harness.cleanup();
  });

  it('does nothing when there is no package yet', () => {
    const harness = runRehydratePattern({
      initialPackage: null,
      lookupLicense: () => ({ id: 'should-not-apply', kind: 1063 })
    });
    flushSync();

    expect(harness.getPackage()).toBeNull();
    harness.cleanup();
  });
});
