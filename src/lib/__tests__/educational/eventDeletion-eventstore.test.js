/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';

// Isolate deleteEvent() from network/IDB side effects; keep the real
// applesauce EventStore so kind-5 propagation is exercised for real.
vi.mock('$lib/services/publish-service.js', () => ({ publishEventOptimistic: vi.fn() }));
vi.mock('$lib/stores/event-cache.svelte.js', () => ({ cacheDeletion: vi.fn() }));
vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  kindToAppRelayCategory: (/** @type {number} */ kind) => (kind === 30142 ? 'educational' : null),
  getAppRelaysForCategory: () => ['wss://amb-relay.example']
}));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: {} }));
vi.mock('$lib/stores/app-settings.svelte.js', () => ({ appSettings: {} }));

import { deleteEvent } from '$lib/helpers/eventDeletion.js';
import { publishEventOptimistic } from '$lib/services/publish-service.js';
import { cacheDeletion } from '$lib/stores/event-cache.svelte.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';

const sk = generateSecretKey();
const pubkey = getPublicKey(sk);
const activeUser = {
  pubkey,
  signer: { signEvent: (/** @type {any} */ draft) => finalizeEvent(draft, sk) }
};

/**
 * DeleteManager records are sticky by design (deletions never un-happen),
 * so every test uses its own d-tag.
 * @param {number} createdAt
 * @param {string} dTag
 */
function makeResource(createdAt, dTag) {
  return finalizeEvent(
    {
      kind: 30142,
      created_at: createdAt,
      tags: [
        ['d', dTag],
        ['name', 'Testressource']
      ],
      content: ''
    },
    sk
  );
}

describe('deleteEvent — applesauce EventStore propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventStore.removeByFilters({ authors: [pubkey] });
  });

  it('builds a NIP-09 kind 5 with e + a tags and hands it to the publish pipeline', async () => {
    const resource = makeResource(1_000_000, 'del-test-tags');
    eventStore.add(resource);

    const result = await deleteEvent(resource, activeUser);
    expect(result.success).toBe(true);

    expect(publishEventOptimistic).toHaveBeenCalledTimes(1);
    const [signedDelete, , opts] = vi.mocked(publishEventOptimistic).mock.calls[0];
    expect(signedDelete.kind).toBe(5);
    expect(signedDelete.tags).toContainEqual(['e', resource.id]);
    expect(
      signedDelete.tags.some(
        (/** @type {string[]} */ t) => t[0] === 'a' && t[1] === `30142:${pubkey}:del-test-tags`
      )
    ).toBe(true);
    // Educational relays must ride along so the AMB relays receive the kind 5.
    expect(opts?.additionalRelays).toContain('wss://amb-relay.example');
    // The deletion is also persisted for IDB replay across reloads.
    expect(cacheDeletion).toHaveBeenCalledWith(signedDelete);
  });

  it('removes the resource from the EventStore immediately (optimistic UI)', async () => {
    const resource = makeResource(1_000_000, 'del-test-optimistic');
    eventStore.add(resource);
    expect(eventStore.getEvent(resource.id)).toBeTruthy();

    await deleteEvent(resource, activeUser);

    expect(eventStore.getEvent(resource.id)).toBeUndefined();
    expect(eventStore.getReplaceable(30142, pubkey, 'del-test-optimistic')).toBeUndefined();
  });

  it('suppresses older versions of the deleted address arriving later from slow relays', async () => {
    const resource = makeResource(1_000_000, 'del-test-stale');
    eventStore.add(resource);
    await deleteEvent(resource, activeUser);

    // A stale copy (older than the delete) streams in afterwards — the
    // DeleteManager's a-tag record must keep it out of the store.
    const stale = makeResource(999_000, 'del-test-stale');
    eventStore.add(stale);
    expect(eventStore.getReplaceable(30142, pubkey, 'del-test-stale')).toBeUndefined();
  });

  it('refuses to delete events owned by someone else', async () => {
    const otherSk = generateSecretKey();
    const foreign = finalizeEvent(
      { kind: 30142, created_at: 1_000_000, tags: [['d', 'x']], content: '' },
      otherSk
    );
    const result = await deleteEvent(foreign, activeUser);
    expect(result.success).toBe(false);
    expect(publishEventOptimistic).not.toHaveBeenCalled();
  });
});
