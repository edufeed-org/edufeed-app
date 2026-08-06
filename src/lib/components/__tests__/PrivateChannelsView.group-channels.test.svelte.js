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

const mockManager = vi.hoisted(() => ({ active: { pubkey: 'a'.repeat(64), signer: {} } }));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: mockManager,
  useActiveUser: () => () => mockManager.active
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
    expect(row.textContent).toContain('\u{1F512}');
    expect(row.querySelector('[data-testid="world-readable-badge"]')).toBeNull();
  });

  // Without this the feature is a dead end: the first channel can be attached
  // from the founding pane, the second one has nowhere to come from.
  it('lets the community owner add another channel once one is listed', async () => {
    holders.concord = { ...holders.concord, enabled: false };
    holders.events = {};

    render(PrivateChannelsView, {
      props: { communikeyEvent: communityEvent([['group', 'allgemein', RELAY]]) }
    });

    expect(await screen.findByTestId('group-attach-open')).toBeTruthy();
  });

  // Only the community's own keypair can rewrite its 10222, so offering the
  // button to anyone else is an offer that cannot be honoured.
  it('does not offer that to someone who is not the community', async () => {
    holders.concord = { ...holders.concord, enabled: false };
    holders.events = {};

    render(PrivateChannelsView, {
      props: {
        communikeyEvent: {
          ...communityEvent([['group', 'allgemein', RELAY]]),
          pubkey: 'b'.repeat(64)
        }
      }
    });

    await screen.findAllByTestId('group-channel-row');
    expect(screen.queryByTestId('group-attach-open')).toBeNull();
  });

  // A community extended by NIP-29 has no Concord area and never will — the
  // founding offer would be an invitation into the mixed state the design
  // rules out.
  it('does not offer to found a concord area for a community extended by groups', () => {
    holders.concord = { ...holders.concord, enabled: false };
    holders.events = {};

    render(PrivateChannelsView, {
      props: { communikeyEvent: communityEvent([['group', 'allgemein', RELAY]]) }
    });

    expect(screen.queryByTestId('concord-new-channel')).toBeNull();
  });

  it('renders nothing for a community with neither concord nor group channels', () => {
    holders.concord = { ...holders.concord, enabled: false };
    holders.events = {};

    render(PrivateChannelsView, { props: { communikeyEvent: communityEvent([]) } });

    expect(screen.queryAllByTestId('group-channel-row')).toHaveLength(0);
  });
});
