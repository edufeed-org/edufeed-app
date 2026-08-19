/** @vitest-environment jsdom */
/**
 * PrivateChannelsView — the community's NIP-29 channels in the same rail.
 *
 * The pure pieces (pointer parsing, access level, row building, request
 * planning) are covered by their own unit tests. What can only be proven
 * here is the WIRING: that the rail actually renders those rows, that it
 * renders at all for a community with no Concord area, and that the glyph
 * a reader sees is the one the access rules produced.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const OWNER = 'a'.repeat(64);
const RELAY = 'wss://groups.example';
const RELAY_N = 'wss://groups.example/';

const mockManager = vi.hoisted(() => ({
  active: { pubkey: 'a'.repeat(64), signer: {} },
  // Single-account default: the active account is registered under its own
  // pubkey, so it holds its own signer (getCommunitySigner/isCommunityOwner).
  getAccountForPubkey: (/** @type {string} */ pk) =>
    pk === 'a'.repeat(64) ? { pubkey: 'a'.repeat(64), signer: {} } : undefined
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: mockManager,
  useActiveUser: () => () => mockManager.active,
  accountsMeta: { version: 0 }
}));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: { concord: { enabled: true } } }));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));

const holders = vi.hoisted(() => ({
  concord: /** @type {any} */ ({
    enabled: false,
    community: undefined,
    channels: [],
    phase: 'idle',
    dissolved: false,
    signerHasNip44: false,
    canManageChannels: false,
    canCreateInvite: false
  }),
  /** @type {Record<string, any[]>} events the fake relay hands back */
  events: /** @type {any} */ ({}),
  /** @type {any} the relay's NIP-11 document; null = the relay never answers */
  relayInfo: /** @type {any} */ (null)
}));
vi.mock('$lib/concord/community.svelte.js', () => ({
  useConcordArea: () => () => holders.concord
}));

// A relay that replies from a per-relay fixture, synchronously on subscribe.
// PARTIAL mock: this module also exports eventStore and the loaders built on
// it, and a whole-module factory would leave those undefined for every other
// importer in the graph (profile.js fails at import time on exactly that).
vi.mock('$lib/stores/nostr-infrastructure.svelte', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return {
    ...actual,
    pool: {
      relay: (/** @type {string} */ relay) => ({
        request: () => ({
          subscribe: (/** @type {any} */ handlers) => {
            for (const event of holders.events[relay] ?? []) handlers.next(event);
            return { unsubscribe() {} };
          }
        }),
        // The channel overview reads the relay's NIP-11 document. This fake
        // answers with whatever the test put in `holders.relayInfo` — a relay
        // that never answers (the default) simply has no badges, which is what
        // the rail tests here are about.
        information$: {
          subscribe: (/** @type {any} */ handlers) => {
            if (holders.relayInfo) handlers.next(holders.relayInfo);
            return { unsubscribe() {} };
          }
        }
      })
    }
  };
});

import PrivateChannelsView from '$lib/components/community/channels/PrivateChannelsView.svelte';

const meta = (/** @type {string} */ id, /** @type {string[][]} */ extra = []) => ({
  kind: 39000,
  tags: [['d', id], ...extra]
});

/** @param {string[][]} groupTags */
const communityEvent = (groupTags) => ({
  kind: 10222,
  pubkey: OWNER,
  content: '',
  tags: [['d', 'relilab'], ...groupTags]
});

describe('PrivateChannelsView — NIP-29 channels in the community rail', () => {
  it('renders the rail for a community with group channels and NO concord area', async () => {
    holders.concord = { ...holders.concord, enabled: false };
    holders.events = { [RELAY_N]: [meta('allgemein', [['private']])] };

    render(PrivateChannelsView, {
      props: { communikeyEvent: communityEvent([['group', 'allgemein', RELAY]]) }
    });

    const rows = await screen.findAllByTestId('group-channel-row');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].textContent).toContain('allgemein');
  });

  it('links a group channel to the group chat that already renders it', async () => {
    holders.concord = { ...holders.concord, enabled: false };
    holders.events = { [RELAY_N]: [meta('allgemein', [['private']])] };

    render(PrivateChannelsView, {
      props: { communikeyEvent: communityEvent([['group', 'allgemein', RELAY]]) }
    });

    const [row] = await screen.findAllByTestId('group-channel-row');
    expect(row.getAttribute('href')).toContain('/groups/');
    expect(decodeURIComponent(row.getAttribute('href') ?? '')).toContain('allgemein');
  });

  // The globe is the whole point of the world-readable level: it says the
  // channel is readable from outside the community, not just inside it.
  it('shows the globe only for a channel the relay leaves open', async () => {
    holders.concord = { ...holders.concord, enabled: false };
    holders.events = {
      [RELAY_N]: [meta('ankuendigungen', [['restricted']]), meta('leitung', [['private']])]
    };

    render(PrivateChannelsView, {
      props: {
        communikeyEvent: communityEvent([
          ['group', 'ankuendigungen', RELAY],
          ['group', 'leitung', RELAY]
        ])
      }
    });

    const rows = await screen.findAllByTestId('group-channel-row');
    const open = rows.find((r) => r.textContent?.includes('ankuendigungen'));
    const shut = rows.find((r) => r.textContent?.includes('leitung'));
    expect(open?.querySelector('[data-testid="world-readable-badge"]')).not.toBeNull();
    expect(shut?.querySelector('[data-testid="world-readable-badge"]')).toBeNull();
  });

  it('draws a channel whose metadata never arrives as locked, not open', async () => {
    holders.concord = { ...holders.concord, enabled: false };
    holders.events = {}; // the relay answers nothing

    render(PrivateChannelsView, {
      props: {
        communikeyEvent: communityEvent([['group', 'allgemein', RELAY, '', 'members']])
      }
    });

    const [row] = await screen.findAllByTestId('group-channel-row');
    expect(row.querySelector('[data-testid="locked-badge"]')).toBeTruthy();
    expect(row.querySelector('[data-testid="world-readable-badge"]')).toBeNull();
  });

  // The "+ Gruppe verknüpfen" attach entry was removed with the linking
  // feature (YAGNI, laoc 2026-08-19) — channels come from the wizard only,
  // and the rail must not resurrect an attach affordance for anyone.
  it('offers no attach entry, not even to the owner', async () => {
    holders.concord = { ...holders.concord, enabled: false };
    holders.events = {};

    render(PrivateChannelsView, {
      props: { communikeyEvent: communityEvent([['group', 'allgemein', RELAY]]) }
    });

    await screen.findAllByTestId('group-channel-row');
    expect(screen.queryByTestId('group-attach-open')).toBeNull();
  });

  // Task 4 (Stufe B "one wizard"): the same "+ New channel" opener now
  // covers the NIP-29 backend too — a community extended by groups offers it
  // to its owner, and the wizard mounted
  // behind it picks the NIP-29 branch itself (parseGroupPointers.length > 0)
  // rather than founding a Concord area — the mixed state the design rules
  // out stays impossible, it just isn't enforced by hiding this button any
  // more (ChannelCreateWizard's own suite covers the branch itself).
  it('offers "+ New channel" (the shared wizard) to the owner of a community extended by groups', () => {
    holders.concord = { ...holders.concord, enabled: false };
    holders.events = {};

    render(PrivateChannelsView, {
      props: { communikeyEvent: communityEvent([['group', 'allgemein', RELAY]]) }
    });

    expect(screen.queryByTestId('concord-new-channel')).not.toBeNull();
  });

  it('renders nothing for a community with neither concord nor group channels', () => {
    holders.concord = { ...holders.concord, enabled: false };
    holders.events = {};

    render(PrivateChannelsView, { props: { communikeyEvent: communityEvent([]) } });

    expect(screen.queryAllByTestId('group-channel-row')).toHaveLength(0);
  });
});
