/** @vitest-environment node */
// publishCommunityUpdate must hand the signer a structured-cloneable template.
// The 10222 source event lives in Svelte $state, so the flip/attach/access-tier
// builders reuse deep reactive-proxy tag entries. A NIP-07 extension signer
// serialises via window.postMessage → structuredClone, which throws
// DataCloneError on a Svelte proxy. Regression guard for that live bug
// (laoc 2026-08-20: "flip to moderated failed DataCloneError ... postMessage").
import { describe, it, expect, vi, beforeEach } from 'vitest';

const publishEvent = vi.fn().mockResolvedValue(undefined);
const eventStoreAdd = vi.fn();
vi.mock('$lib/services/publish-service.js', () => ({ publishEvent }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: eventStoreAdd }
}));
vi.mock('$lib/helpers/communityRelays.js', () => ({
  getCommunityGlobalRelays: () => []
}));

import { publishCommunityUpdate } from '$lib/helpers/publishCommunityUpdate.js';

// A stand-in for a Svelte $state deep proxy: a Proxy whose get/has traps make
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

// A minimal ExtensionSigner: it does what nostr-provider.js does — round-trips
// the template through structuredClone (the postMessage boundary) before
// "signing". Throws DataCloneError on a proxy, succeeds on a plain object.
const extensionSigner = {
  signEvent: vi.fn(async (template) => {
    structuredClone(template); // throws DataCloneError on a Svelte proxy
    return { ...template, id: 'signed', sig: 'x', pubkey: 'p' };
  })
};

describe('publishCommunityUpdate', () => {
  beforeEach(() => {
    publishEvent.mockClear();
    eventStoreAdd.mockClear();
    extensionSigner.signEvent.mockClear();
  });

  it('de-proxies reactive tags so an extension signer can postMessage the template', async () => {
    const template = {
      kind: 10222,
      content: '',
      created_at: 100,
      tags: [
        reactiveTag(['d', 'edufeed']),
        reactiveTag(['name', 'My Community']),
        reactiveTag(['membership', 'root1', 'wss://groups.edufeed.org'])
      ]
    };

    // Pre-condition: the raw template is NOT cloneable (proves the bug is real).
    expect(() => structuredClone(template)).toThrow();

    const signed = await publishCommunityUpdate(template, extensionSigner);

    expect(extensionSigner.signEvent).toHaveBeenCalledTimes(1);
    const passed = extensionSigner.signEvent.mock.calls[0][0];
    // What reached the signer is plain and cloneable.
    expect(() => structuredClone(passed)).not.toThrow();
    expect(passed.tags).toEqual(template.tags.map((t) => [...t]));
    expect(signed.id).toBe('signed');
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(eventStoreAdd).toHaveBeenCalledWith(signed);
  });

  it('leaves an already-plain template working (in-process signer path)', async () => {
    const nsecSigner = {
      signEvent: vi.fn(async (t) => ({ ...t, id: 'plain-signed' }))
    };
    const template = { kind: 10222, content: '', created_at: 1, tags: [['d', 'x']] };
    const signed = await publishCommunityUpdate(template, nsecSigner);
    expect(signed.id).toBe('plain-signed');
    expect(nsecSigner.signEvent.mock.calls[0][0].tags).toEqual([['d', 'x']]);
  });
});
