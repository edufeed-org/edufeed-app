// @ts-nocheck
/**
 * The community-signed publishers list (kind 30000, d=publishers) is an ACL
 * the community's readers resolve — it must reach the community's own relays,
 * not just the deployment's communikey relays.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

const publishEvent = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock('$lib/services/publish-service.js', () => ({ publishEvent }));
vi.mock('$lib/concord/community.svelte.js', () => ({ useConcordCommunity: vi.fn() }));
vi.mock('$lib/concord/bridge.svelte.js', () => ({ useObservable: vi.fn() }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore: { add: vi.fn() } }));
vi.mock('$lib/loaders/base.js', () => ({ addressLoader: vi.fn() }));
vi.mock('$lib/helpers/publishCommunityUpdate.js', () => ({ publishCommunityUpdate: vi.fn() }));
vi.mock('$lib/groups/community-flips.js', () => ({ communityUpdateTemplate: vi.fn() }));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: vi.fn() }));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => ['wss://communikey.app/'],
  getAllLookupRelays: () => []
}));

import { syncPublishersList } from '$lib/concord/publisher-window.svelte.js';

describe('syncPublishersList', () => {
  it("publishes the list to the community's relays and the communikey relays", async () => {
    const communikeyEvent = {
      kind: 10222,
      pubkey: 'c'.repeat(64),
      tags: [['r', 'wss://community.example']]
    };
    const communitySigner = { signEvent: vi.fn(async (t) => ({ ...t, id: 'x', sig: '' })) };

    await syncPublishersList({ communikeyEvent, communitySigner, shouldList: [], listEvent: null });

    expect(publishEvent.mock.calls[0][2].additionalRelays).toEqual(
      expect.arrayContaining(['wss://communikey.app/', 'wss://community.example/'])
    );
  });
});
