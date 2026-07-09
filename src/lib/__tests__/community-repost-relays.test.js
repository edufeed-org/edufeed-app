// @ts-nocheck
/**
 * createCommunityReposts relay-routing tests (edufeed-app#21)
 *
 * The kind 16 community repost must reach the relays the community surfaces
 * actually read: the communikey app relays, the app relays of the SHARED
 * kind, and the target community's own relays (from its kind 10222) —
 * publishing only to the sharer's outbox makes the share invisible.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const publishEventOptimistic = vi.fn();
vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: (...args) => publishEventOptimistic(...args)
}));
vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({
    share: async (event) => ({
      kind: 16,
      content: JSON.stringify(event),
      tags: [
        ['e', event.id],
        ['a', `${event.kind}:${event.pubkey}:d1`],
        ['k', String(event.kind)]
      ]
    }),
    sign: async (t) => ({ ...t, id: 'f'.repeat(64), pubkey: 'a'.repeat(64), sig: '' })
  })
}));
vi.mock('applesauce-common/blueprints', () => ({}));
vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: vi.fn((cat) =>
    cat === 'communikey'
      ? ['wss://relay.edufeed.org']
      : cat === 'calendar'
        ? ['wss://calendar.edufeed.org']
        : []
  ),
  kindToAppRelayCategory: vi.fn((kind) => (kind === 31922 || kind === 31923 ? 'calendar' : null))
}));
vi.mock('$lib/helpers/communityRelays.js', () => ({
  getRelaysForKind: vi.fn(() => ['wss://community-content.example']),
  getCommunityGlobalRelays: vi.fn(() => ['wss://community-global.example']),
  getCommunityRelaysByEnforcement: vi.fn(() => ({
    enforced: ['wss://community-enforced.example'],
    optional: []
  }))
}));
const getReplaceable = vi.fn();
vi.mock('$lib/stores/nostr-infrastructure.svelte.js', () => ({
  eventStore: { getReplaceable: (...args) => getReplaceable(...args) }
}));

import { createCommunityReposts } from '$lib/helpers/communityRepost.js';

const COMMUNITY = 'b'.repeat(64);
const EVENT = {
  id: '1'.repeat(64),
  kind: 31922,
  pubkey: 'c'.repeat(64),
  tags: [['d', 'd1']],
  content: '',
  created_at: 0
};

describe('createCommunityReposts relay routing', () => {
  beforeEach(() => {
    publishEventOptimistic.mockClear();
    getReplaceable.mockReset();
  });

  it('publishes to communikey + shared-kind app relays and the community relays from its 10222', async () => {
    getReplaceable.mockReturnValue({ kind: 10222, pubkey: COMMUNITY, tags: [] });

    await createCommunityReposts(EVENT, [COMMUNITY], {});

    const opts = publishEventOptimistic.mock.calls[0][2];
    expect(opts.additionalRelays).toEqual(
      expect.arrayContaining([
        'wss://relay.edufeed.org',
        'wss://calendar.edufeed.org',
        'wss://community-content.example',
        'wss://community-global.example',
        'wss://community-enforced.example'
      ])
    );
  });

  it('still includes the app relays when the community 10222 is not in the store', async () => {
    getReplaceable.mockReturnValue(null);

    await createCommunityReposts(EVENT, [COMMUNITY], {});

    const opts = publishEventOptimistic.mock.calls[0][2];
    expect(opts.additionalRelays).toEqual(
      expect.arrayContaining(['wss://relay.edufeed.org', 'wss://calendar.edufeed.org'])
    );
  });
});
