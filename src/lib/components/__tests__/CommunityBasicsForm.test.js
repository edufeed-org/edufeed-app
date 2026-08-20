/** @vitest-environment jsdom */
/**
 * CommunityBasicsForm.save() must hand the community signer a
 * structured-cloneable 10222. The template reuses the source event's pointer
 * tags verbatim (preservePointerTags), and those live in Svelte $state as deep
 * reactive proxies. A NIP-07 extension signer serialises via
 * window.postMessage → structuredClone, which throws DataCloneError on a proxy.
 * Regression guard for the live bug (laoc 2026-08-20: "Error updating
 * community: DataCloneError ... at CommunityBasicsForm.svelte save").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const OWNER = 'a'.repeat(64);

// Extension-style signer: does what nostr-provider.js does — round-trips the
// template through structuredClone (the postMessage boundary) before signing.
// Throws DataCloneError on a Svelte proxy, succeeds on a plain object.
const extensionSigner = vi.hoisted(() => ({
  signEvent: vi.fn(async (/** @type {any} */ template) => {
    structuredClone(template); // throws on a reactive proxy
    return { ...template, id: 'signed', sig: 'x', pubkey: OWNER };
  })
}));
vi.mock('$lib/helpers/community-signer.js', () => ({
  getCommunitySigner: () => extensionSigner,
  isCommunityOwner: () => true
}));

const publishEventOptimistic = vi.hoisted(() => vi.fn());
vi.mock('$lib/services/publish-service.js', () => ({ publishEventOptimistic }));

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/toast', () => ({ showToast: toastSpy }));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    add: vi.fn(),
    replaceable: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
  }
}));
vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));

const { default: CommunityBasicsForm } = await import(
  '$lib/components/community/settings/CommunityBasicsForm.svelte'
);

// A stand-in for a Svelte $state deep proxy: a Proxy whose get trap makes
// structuredClone (and thus postMessage) throw, exactly like the runtime one.
/** @param {string[]} arr */
function reactiveTag(arr) {
  return new Proxy(arr, {
    get(target, prop, receiver) {
      if (prop === Symbol.for('svelte-proxy')) return true;
      return Reflect.get(target, prop, receiver);
    }
  });
}

describe('CommunityBasicsForm — save de-proxies before signing', () => {
  beforeEach(() => {
    extensionSigner.signEvent.mockClear();
    publishEventOptimistic.mockClear();
    toastSpy.mockClear();
  });

  it('hands the extension signer a structured-cloneable template (no DataCloneError)', async () => {
    // A moderated community: the membership pointer is preserved verbatim by
    // preservePointerTags, so its reactive-proxy entry reaches the template —
    // exactly the runtime path that crashed.
    const communikeyEvent = {
      kind: 10222,
      id: 'evt1',
      pubkey: OWNER,
      created_at: 1000,
      content: 'desc',
      tags: [
        reactiveTag(['d', 'edufeed']),
        reactiveTag(['name', 'My Community']),
        reactiveTag(['r', 'wss://relay.edufeed.org']),
        reactiveTag(['membership', 'root1', 'wss://groups.edufeed.org'])
      ]
    };

    render(CommunityBasicsForm, { props: { communikeyEvent } });

    await fireEvent.click(await screen.findByTestId('basics-save'));

    // The signer was called, and the template it received is cloneable.
    await waitFor(() => expect(extensionSigner.signEvent).toHaveBeenCalled());
    const passed = extensionSigner.signEvent.mock.calls[0][0];
    expect(() => structuredClone(passed)).not.toThrow();
    // The preserved membership pointer is present and de-proxied.
    expect(passed.tags).toEqual(
      expect.arrayContaining([['membership', 'root1', 'wss://groups.edufeed.org']])
    );

    // Save succeeded end-to-end: published + success toast, no error toast.
    await waitFor(() => expect(publishEventOptimistic).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith(expect.anything(), 'success');
  });
});
