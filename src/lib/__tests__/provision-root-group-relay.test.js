/**
 * @vitest-environment node
 *
 * provisionRootGroup against the e2e mock NIP-29 relay (e2e/nip29-relay.js),
 * driven by the real applesauce RelayPool and a real SimpleSigner — the exact
 * wire path the create-community wizard runs. Written for issue wc4x0lnp (the
 * moderated-community e2e specs failing with "Reflect.has called on
 * non-object"): it proves the relay path itself is sound, which is what put
 * the blame on the wizard's profile read (see root-group-seed.test.js).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { RelayPool } from 'applesauce-relay';
import { EventStore } from 'applesauce-core';
import { SimpleSigner } from 'applesauce-signers';
import { generateSecretKey, getPublicKey } from 'nostr-tools';

const PORT = 17904;
const infra = vi.hoisted(() => ({
  pool: /** @type {any} */ (null),
  eventStore: /** @type {any} */ (null)
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  get pool() {
    return infra.pool;
  },
  get eventStore() {
    return infra.eventStore;
  }
}));

const { provisionRootGroup } = await import('$lib/groups/provision-root-group.js');

/** @type {{server: import('http').Server, wss: any, relayPubkey: string}} */
let relay;

beforeAll(async () => {
  const { startRelay } = await import('../../../e2e/nip29-relay.js');
  relay = await startRelay(PORT);
  infra.pool = new RelayPool();
  infra.eventStore = new EventStore();
});

afterAll(async () => {
  for (const conn of infra.pool?.relays?.values?.() ?? []) conn.close?.();
  const { stopRelay } = await import('../../../e2e/nip29-relay.js');
  if (relay) await stopRelay(relay);
});

describe('provisionRootGroup on the mock NIP-29 relay', () => {
  it('creates and confirms a root group with a SimpleSigner user', async () => {
    const sk = generateSecretKey();
    const pubkey = getPublicKey(sk);
    const signer = new SimpleSigner(sk);
    const communitySk = generateSecretKey();
    const communityPubkey = getPublicKey(communitySk);

    const pointer = await provisionRootGroup({
      relay: `ws://localhost:${PORT}`,
      name: 'Test community',
      about: 'about text',
      picture: undefined,
      user: { pubkey, signer },
      existingId: null,
      communityPubkey
    });
    expect(pointer.relay).toBe(`ws://localhost:${PORT}`);
    expect(pointer.id).toMatch(/^[0-9a-f-]{36}$/);
  }, 30_000);
});
