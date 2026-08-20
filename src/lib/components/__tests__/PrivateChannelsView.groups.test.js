/** @vitest-environment jsdom */
/**
 * PrivateChannelsView — the pane of a community extended by NIP-29 groups.
 *
 * Channels are DISCOVERED from the relay subtree (useCommunityChannels), not
 * from kind-10222 `group` pointers, so this fakes that hook (it opens relay
 * subscriptions) and the NIP-11 hook. It asserts the WIRING: the real
 * ChannelOverview / buildChannelRows render the subtree the hook returns, the
 * General row is pinned from the root, and channel creation/management is gated
 * on root-39001-admin ∪ key-holding owner — NOT on holding the community key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const OWNER = 'a'.repeat(64);
const STRANGER = 'e'.repeat(64);
const RELAY = 'wss://groups.example';
const ENDPOINT = 'wss://groups.example/c/root0';

const mockManager = vi.hoisted(() => ({
  active: { pubkey: 'a'.repeat(64), signer: {} },
  getAccountForPubkey: (/** @type {string} */ pk) =>
    pk === 'a'.repeat(64) ? { pubkey: 'a'.repeat(64), signer: {} } : undefined
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: mockManager,
  useActiveUser: () => () => mockManager.active,
  accountsMeta: { version: 0 }
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { concord: { enabled: false } },
  configReady: { subscribe: () => () => {} }
}));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));

const deleteChannelCascade = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$lib/groups/community-teardown.js', () => ({ deleteChannelCascade }));
vi.mock('$lib/helpers/joined-communikey-events.svelte.js', () => ({
  useJoinedCommunikeyEvents: () => () => []
}));

const holders = vi.hoisted(() => ({
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
  /** @type {any[]} */ subtreeChannels: [],
  /** @type {any} */ rootChannel: null,
  /** @type {Array<{pubkey: string, roles: string[]}>} */ rootAdmins: [],
  /** @type {any} */ relayInfo: null,
  /** @type {Array<() => any>} */ relayAsked: []
}));
vi.mock('$lib/concord/community.svelte.js', () => ({
  useConcordArea: () => () => holders.concord
}));
vi.mock('$lib/groups/community-channels.svelte.js', () => ({
  useCommunityChannels: () => () => ({
    channels: holders.subtreeChannels,
    rootChannel: holders.rootChannel,
    fetched: true,
    refresh: () => {}
  })
}));
vi.mock('$lib/groups/root-roster.svelte.js', () => ({
  useRootRoster: () => () => ({
    pointer: null,
    admins: holders.rootAdmins,
    isMember: (/** @type {string} */ pk) => holders.rootAdmins.some((a) => a.pubkey === pk),
    rolesOf: () => [],
    refresh: () => {}
  })
}));
vi.mock('$lib/groups/relay-information.svelte.js', () => ({
  useRelayInformation: (/** @type {() => any} */ getRelay) => {
    holders.relayAsked.push(getRelay);
    return () => holders.relayInfo;
  }
}));

import PrivateChannelsView from '$lib/components/community/channels/PrivateChannelsView.svelte';
import { channelAccessLevel } from '$lib/groups/channel-access.js';

/** A moderated community: a membership (root) pointer, discovery via subtree. */
const moderated = (
  /** @type {string} */ pubkey = OWNER,
  /** @type {string} */ rootRelay = RELAY
) => ({
  kind: 10222,
  pubkey,
  content: '',
  tags: [
    ['d', 'relilab'],
    ['membership', 'root0', rootRelay]
  ]
});

/** A subtree channel, as useCommunityChannels yields it. */
const chan = (/** @type {string} */ id, /** @type {string[][]} */ tags = []) => {
  const metadata = { kind: 39000, tags: [['d', id], ...tags] };
  return {
    id,
    relay: ENDPOINT,
    name: metadata.tags.find((t) => t[0] === 'name')?.[1],
    level: channelAccessLevel(metadata),
    metadata
  };
};

beforeEach(() => {
  holders.subtreeChannels = [];
  holders.rootChannel = null;
  holders.rootAdmins = [];
  holders.relayInfo = null;
  holders.relayAsked = [];
  deleteChannelCascade.mockClear();
});

describe('PrivateChannelsView — a community extended by NIP-29 groups', () => {
  it('lands on the channel overview, not a placard', () => {
    holders.subtreeChannels = [
      chan('allgemein', [['name', 'Allgemein'], ['private'], ['about', 'Alles Weitere']])
    ];
    render(PrivateChannelsView, { props: { communikeyEvent: moderated() } });
    const cards = screen.getAllByTestId('channel-card');
    expect(cards).toHaveLength(1);
    // In the community pane the card selects in place (button), not a link out.
    expect(cards[0].getAttribute('href')).toBeNull();
    expect(screen.getByTestId('channel-card-topic').textContent).toBe('Alles Weitere');
  });

  it('asks for the community host relay document (the root membership pointer relay)', () => {
    render(PrivateChannelsView, { props: { communikeyEvent: moderated() } });
    expect(holders.relayAsked[0]()).toBe(RELAY);
  });

  it('shows what the single host announces about itself', () => {
    holders.relayInfo = {
      limitation: { auth_required: true },
      supported_nips: [1, 29],
      software: 'git+https://example/pyramid',
      version: '1.2'
    };
    render(PrivateChannelsView, { props: { communikeyEvent: moderated() } });
    expect(screen.getByTestId('group-badge-auth')).toBeTruthy();
    expect(screen.getByTestId('group-badge-nip29')).toBeTruthy();
    expect(screen.getByTestId('group-badge-software').textContent?.trim()).toBe('pyramid 1.2');
  });

  it('owner gets a per-channel delete that runs the cascade after confirm', async () => {
    holders.subtreeChannels = [chan('allgemein', [['name', 'Allgemein']])];
    render(PrivateChannelsView, { props: { communikeyEvent: moderated() } });
    await fireEvent.click(await screen.findByTestId('group-channel-delete'));
    await fireEvent.click(await screen.findByTestId('group-channel-delete-confirm'));
    await waitFor(() => expect(deleteChannelCascade).toHaveBeenCalledOnce());
    const [cascadeArg] = /** @type {any[]} */ (deleteChannelCascade.mock.calls[0]);
    expect(cascadeArg.pointer.id).toBe('allgemein');
  });

  it('pins the root membership group as a "General" channel row with no delete', async () => {
    holders.rootChannel = chan('root0', [['name', 'laoc42']]);
    holders.subtreeChannels = [chan('willkommen', [['name', 'Willkommen']])];
    render(PrivateChannelsView, { props: { communikeyEvent: moderated() } });
    const rows = await screen.findAllByTestId('group-channel-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('General'); // root pinned first, labeled General
    expect(rows[1].textContent).toContain('Willkommen'); // the real channel follows
    // The General row exposes no delete; the real channel does. One kebab.
    expect(screen.getAllByTestId('group-channel-delete').length).toBe(1);
  });

  it('a NON-owner root-39001 admin can create AND delete channels (no community key)', async () => {
    // Community owned by STRANGER — the active account does NOT hold its key.
    holders.rootAdmins = [{ pubkey: OWNER, roles: ['admin'] }];
    holders.subtreeChannels = [chan('allgemein', [['name', 'Allgemein']])];
    render(PrivateChannelsView, { props: { communikeyEvent: moderated(STRANGER) } });
    // The core new behavior: a root admin sees "+ Neuer Kanal" though they are
    // not the key-holder.
    expect(await screen.findByTestId('concord-new-channel')).toBeTruthy();
    // …and the per-channel delete kebab.
    expect(await screen.findByTestId('group-channel-delete')).toBeTruthy();
  });

  it('hides create + per-channel delete for a non-owner, non-admin', async () => {
    holders.rootAdmins = []; // active account is neither owner nor a root admin
    holders.subtreeChannels = [chan('allgemein', [['name', 'Allgemein']])];
    render(PrivateChannelsView, { props: { communikeyEvent: moderated(STRANGER) } });
    await screen.findByTestId('group-channel-row');
    expect(screen.queryByTestId('group-channel-delete')).toBeNull();
    expect(screen.queryByTestId('concord-new-channel')).toBeNull();
  });
});
