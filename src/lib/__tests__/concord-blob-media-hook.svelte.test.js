// @ts-nocheck
/* eslint-disable no-undef -- $effect/$state are Svelte runes, available in .svelte.test.js context */
/** @vitest-environment jsdom */
// Behavior tests for useConcordAreaIcon (Concord community-icon rendering
// follow-up): reacts to the icon BlobPointer getter, resolves through
// fetchDecryptedBlobUrl (mocked here — jsdom lacks crypto.subtle/fetch, see
// concord-blob-media.test.js for the real decrypt-path coverage), and
// tears down cleanly without leaking a stale URL into a later pointer.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

const holders = vi.hoisted(() => ({
  pointer: /** @type {any} */ (undefined),
  resolveWith: /** @type {(p: any) => Promise<string|null>} */ (async () => null),
  fetchSpy: vi.fn()
}));

vi.mock('$lib/concord/blob-media.js', () => ({
  fetchDecryptedBlobUrl: (/** @type {any} */ pointer) => {
    holders.fetchSpy(pointer);
    return holders.resolveWith(pointer);
  }
}));

import { useConcordAreaIcon } from '$lib/concord/blob-media.svelte.js';

/** @param {() => any} getIconPointer */
function mountHook(getIconPointer) {
  /** @type {() => string | null} */
  let getUrl;
  const cleanup = $effect.root(() => {
    getUrl = useConcordAreaIcon(getIconPointer);
  });
  flushSync();
  return { getUrl: () => getUrl(), cleanup };
}

describe('useConcordAreaIcon', () => {
  beforeEach(() => {
    holders.pointer = undefined;
    holders.fetchSpy = vi.fn();
    holders.resolveWith = async () => null;
  });

  it('returns null and never calls fetchDecryptedBlobUrl when there is no pointer', () => {
    const { getUrl, cleanup } = mountHook(() => undefined);
    expect(getUrl()).toBeNull();
    expect(holders.fetchSpy).not.toHaveBeenCalled();
    cleanup();
  });

  it('returns null for an incomplete pointer (missing key/nonce/hash)', () => {
    const { getUrl, cleanup } = mountHook(() => ({ url: 'https://x/blob' }));
    expect(getUrl()).toBeNull();
    expect(holders.fetchSpy).not.toHaveBeenCalled();
    cleanup();
  });

  it('resolves the object URL once fetchDecryptedBlobUrl settles', async () => {
    const pointer = {
      url: 'https://x/blob',
      key: 'a'.repeat(64),
      nonce: 'b'.repeat(32),
      hash: 'c'.repeat(64)
    };
    holders.resolveWith = async () => 'blob:resolved-url';

    const { getUrl, cleanup } = mountHook(() => pointer);
    expect(getUrl()).toBeNull(); // still loading, synchronously
    await Promise.resolve();
    await Promise.resolve();
    flushSync();

    expect(getUrl()).toBe('blob:resolved-url');
    expect(holders.fetchSpy).toHaveBeenCalledWith(pointer);
    cleanup();
  });

  it('resets to null when the pointer disappears', async () => {
    const pointer = {
      url: 'https://x/blob',
      key: 'a'.repeat(64),
      nonce: 'b'.repeat(32),
      hash: 'c'.repeat(64)
    };
    holders.resolveWith = async () => 'blob:resolved-url';

    // Must be $state, not a plain closure variable — the effect only
    // re-runs on a tracked reactive dependency, matching how a real
    // component's prop/derived would drive `getIconPointer`.
    let current = $state(pointer);
    const { getUrl, cleanup } = mountHook(() => current);
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(getUrl()).toBe('blob:resolved-url');

    current = undefined;
    flushSync();
    expect(getUrl()).toBeNull();
    cleanup();
  });

  it('does not apply a stale resolution after teardown (cancelled flag)', async () => {
    const pointer = {
      url: 'https://x/blob',
      key: 'a'.repeat(64),
      nonce: 'b'.repeat(32),
      hash: 'c'.repeat(64)
    };
    let resolveFetch;
    holders.resolveWith = () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      });

    const { getUrl, cleanup } = mountHook(() => pointer);
    cleanup(); // unmount before the fetch resolves
    resolveFetch('blob:too-late');
    await Promise.resolve();
    await Promise.resolve();

    expect(getUrl()).toBeNull();
  });
});
