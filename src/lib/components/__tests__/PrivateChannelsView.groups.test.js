/** @vitest-environment jsdom */
/**
 * PrivateChannelsView — the pane of a community extended by NIP-29 groups.
 *
 * Last round's first attempt wired a feature into a file with no importers and
 * every unit test stayed green, so this asserts the WIRING: that the real
 * ChannelOverview is what this pane mounts, fed by the real parseGroupPointers
 * and buildChannelRows off a real kind:10222.
 *
 * Only the two data hooks are faked (relay metadata, NIP-11), because they open
 * relay subscriptions. The relay-information hook is captured rather than
 * stubbed blind: what it is ASKED for is the sharedRelayOf gate, and that is
 * part of the wiring under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const OWNER = 'a'.repeat(64);
const RELAY = 'wss://groups.example';
const OTHER_RELAY = 'wss://andere.example';

const mockManager = vi.hoisted(() => ({ active: { pubkey: 'a'.repeat(64), signer: {} } }));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: mockManager,
  useActiveUser: () => () => mockManager.active
}));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: { concord: { enabled: false } } }));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));

const holders = vi.hoisted(() => ({
  // The Concord flag is OFF here on purpose: a community extended by groups
  // has no Concord area at all, and this pane still has to render for it.
  concord: /** @type {any} */ ({
    enabled: false,
    community: undefined,
    channels: [],
    phase: 'idle',
    dissolved: false,
    signerHasNip44: false,
    canManageChannels: false,
    canCreateInvite: false,
    communityId: undefined
  }),
  /** @type {any} */ metadataByKey: {},
  /** @type {any} */ relayInfo: null,
  /** @type {Array<() => any>} */ relayAsked: []
}));
vi.mock('$lib/concord/community.svelte.js', () => ({
  useConcordArea: () => () => holders.concord
}));
vi.mock('$lib/groups/channel-metadata.svelte.js', () => ({
  useChannelMetadata: () => () => ({ byKey: holders.metadataByKey })
}));
vi.mock('$lib/groups/relay-information.svelte.js', () => ({
  useRelayInformation: (/** @type {() => any} */ getRelay) => {
    holders.relayAsked.push(getRelay);
    return () => holders.relayInfo;
  }
}));

import PrivateChannelsView from '$lib/components/community/channels/PrivateChannelsView.svelte';
import { channelKey } from '$lib/groups/community-pointer.js';

/** @param {string[][]} groupTags */
const community = (groupTags) => ({
  kind: 10222,
  pubkey: OWNER,
  content: '',
  tags: [['d', 'relilab'], ...groupTags]
});

const meta = (/** @type {string} */ id, /** @type {string[][]} */ extra = []) => ({
  kind: 39000,
  tags: [['d', id], ...extra]
});

beforeEach(() => {
  holders.metadataByKey = {};
  holders.relayInfo = null;
  holders.relayAsked = [];
});

describe('PrivateChannelsView — a community extended by NIP-29 groups', () => {
  it('lands on the channel overview, not a placard', () => {
    holders.metadataByKey = {
      [/** @type {string} */ (channelKey({ id: 'allgemein', relay: RELAY }))]: meta('allgemein', [
        ['name', 'Allgemein'],
        ['private'],
        ['about', 'Alles Weitere']
      ])
    };
    render(PrivateChannelsView, {
      props: {
        communikeyEvent: community([['group', 'allgemein', RELAY, 'Allgemein', 'members']])
      }
    });
    const cards = screen.getAllByTestId('channel-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute('href')).toBe("/groups/groups.example'allgemein");
    expect(screen.getByTestId('channel-card-topic').textContent).toBe('Alles Weitere');
  });

  it('asks for the relay document when every channel is on one relay', () => {
    render(PrivateChannelsView, {
      props: {
        communikeyEvent: community([
          ['group', 'allgemein', RELAY],
          ['group', 'leitung', RELAY]
        ])
      }
    });
    expect(holders.relayAsked).toHaveLength(1);
    expect(holders.relayAsked[0]()).toBe(RELAY);
  });

  // Badges describe ONE host. With two, there is no single answer, so nothing
  // is fetched and nothing is shown.
  it('asks for no relay document once the channels span two relays', () => {
    render(PrivateChannelsView, {
      props: {
        communikeyEvent: community([
          ['group', 'allgemein', RELAY],
          ['group', 'leitung', OTHER_RELAY]
        ])
      }
    });
    expect(holders.relayAsked).toHaveLength(1);
    expect(holders.relayAsked[0]()).toBeNull();
  });

  it('shows what the single host announces about itself', () => {
    holders.relayInfo = {
      limitation: { auth_required: true },
      supported_nips: [1, 29],
      software: 'git+https://example/pyramid',
      version: '1.2'
    };
    render(PrivateChannelsView, {
      props: { communikeyEvent: community([['group', 'allgemein', RELAY]]) }
    });
    expect(screen.getByTestId('group-badge-auth')).toBeTruthy();
    expect(screen.getByTestId('group-badge-nip29')).toBeTruthy();
    expect(screen.getByTestId('group-badge-software').textContent?.trim()).toBe('pyramid 1.2');
  });
});
