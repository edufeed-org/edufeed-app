/** @vitest-environment jsdom */
/**
 * PrivateChannelsView — the community's NIP-29 channels in the same rail.
 *
 * Drives the REAL useCommunityChannels end-to-end through a mocked pool: the
 * fake relay hands back kind:39000 events for the /c/<rootId> endpoint, they
 * flow through the eventStore, and buildChannelRows renders the rail. What can
 * only be proven here is the WIRING: that channels are DISCOVERED from the
 * subtree (parent==rootId), that the glyph a reader sees is the one the access
 * rules produced, and that the shared "+ New channel" opener shows for a
 * community extended by groups.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const OWNER = 'a'.repeat(64);
const RELAY = 'wss://groups.example';

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
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: { concord: { enabled: true } } }));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));
vi.mock('$lib/components/groups/GroupChat.svelte', () => import('./fixtures/GroupChatStub.svelte'));
// The /c endpoint reveals private children only to authed members — the hook
// authenticates proactively. The fake pool has no auth surface, so stub it.
vi.mock('$lib/groups/relay-auth.js', () => ({
  authenticateOnce: () => Promise.resolve({ ok: false })
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
    canCreateInvite: false
  }),
  /** @type {Record<string, any[]>} events the fake relay hands back per URL */
  events: /** @type {any} */ ({}),
  /** @type {any} */ relayInfo: /** @type {any} */ (null),
  /** @type {string | null} current page URL, for ?channel= deep-link tests */
  pageUrl: /** @type {string | null} */ (null)
}));

vi.mock('$app/stores', () => ({
  page: {
    subscribe: (/** @type {any} */ cb) => {
      cb(holders.pageUrl ? { url: new URL(holders.pageUrl) } : {});
      return () => {};
    }
  }
}));
vi.mock('$lib/concord/community.svelte.js', () => ({
  useConcordArea: () => () => holders.concord
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  const { of } = await import('rxjs');
  return {
    ...actual,
    pool: {
      relay: (/** @type {string} */ relay) => ({
        // A real Observable — the discovery/roster hooks .pipe(storeEvents(...))
        // it. Emits each fixture event, then completes.
        request: () => of(...(holders.events[relay] ?? [])),
        // The subtree discovery switched to a live subscription: fixture
        // events, then the EOSE marker a real NIP-01 sub emits.
        subscription: () => of(...(holders.events[relay] ?? []), 'EOSE'),
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
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { clearGroupChannelSelection } from '$lib/groups/group-channel-selection.svelte.js';
import { communityGroupsEndpoint, flatGroupsRelay } from '$lib/groups/community-endpoint.js';

// Fixtures signed by a fake relay key — bypass signature verification.
eventStore.verifyEvent = () => true;

const ENDPOINT = communityGroupsEndpoint(flatGroupsRelay(RELAY), 'root0');

let seq = 0;
const meta = (/** @type {string} */ id, /** @type {string[][]} */ extra = []) => ({
  kind: 39000,
  pubkey: '9'.repeat(64),
  created_at: 1000 + seq,
  id: `ev-${id}-${seq++}`,
  sig: 'x',
  content: '',
  tags: [['d', id], ...extra]
});
/** A child channel of root0. */
const chan = (/** @type {string} */ id, /** @type {string[][]} */ extra = []) =>
  meta(id, [['name', id], ['parent', 'root0'], ...extra]);
const root = () => meta('root0', [['name', 'laoc42']]);

/** A moderated community: membership (root) pointer → subtree discovery. */
const moderated = () => ({
  kind: 10222,
  pubkey: OWNER,
  content: '',
  tags: [
    ['d', 'relilab'],
    ['membership', 'root0', RELAY]
  ]
});

beforeEach(() => {
  holders.concord = { ...holders.concord, enabled: false };
  holders.events = {};
  holders.relayInfo = null;
  holders.pageUrl = null;
  eventStore.removeByFilters?.({ kinds: [39000] });
});

describe('PrivateChannelsView — NIP-29 channels in the community rail', () => {
  it('renders the rail from the subtree for a community with NO concord area', async () => {
    holders.events = { [ENDPOINT]: [root(), chan('allgemein', [['private']])] };

    render(PrivateChannelsView, { props: { communikeyEvent: moderated() } });

    const rows = await screen.findAllByTestId('group-channel-row');
    expect(rows.some((r) => r.textContent?.includes('allgemein'))).toBe(true);
  });

  it('clicking a group row renders its chat in the pane instead of leaving for /groups', async () => {
    holders.events = { [ENDPOINT]: [root(), chan('allgemein', [['private']])] };

    render(PrivateChannelsView, { props: { communikeyEvent: moderated() } });

    const rows = await screen.findAllByTestId('group-channel-row');
    const row = /** @type {HTMLElement} */ (rows.find((r) => r.textContent?.includes('allgemein')));
    expect(row.getAttribute('href')).toBeNull();
    await fireEvent.click(row);

    const chat = await screen.findByTestId('group-chat-stub');
    expect(chat.textContent).toContain('allgemein');
  });

  it('shows the globe only for a channel the relay leaves open', async () => {
    holders.events = {
      [ENDPOINT]: [root(), chan('ankuendigungen', [['restricted']]), chan('leitung', [['private']])]
    };

    render(PrivateChannelsView, { props: { communikeyEvent: moderated() } });

    const rows = await screen.findAllByTestId('group-channel-row');
    const open = rows.find((r) => r.textContent?.includes('ankuendigungen'));
    const shut = rows.find((r) => r.textContent?.includes('leitung'));
    expect(open?.querySelector('[data-testid="world-readable-badge"]')).not.toBeNull();
    expect(shut?.querySelector('[data-testid="world-readable-badge"]')).toBeNull();
  });

  // The "+ Gruppe verknüpfen" attach entry was removed with the linking
  // feature (YAGNI) — channels come from the wizard only, and the rail must not
  // resurrect an attach affordance for anyone.
  it('offers no attach entry, not even to the owner', async () => {
    holders.events = { [ENDPOINT]: [root(), chan('allgemein', [['private']])] };

    render(PrivateChannelsView, { props: { communikeyEvent: moderated() } });

    await screen.findAllByTestId('group-channel-row');
    expect(screen.queryByTestId('group-attach-open')).toBeNull();
  });

  it('offers "+ New channel" (the shared wizard) to the owner of a moderated community', () => {
    holders.events = { [ENDPOINT]: [root()] };

    render(PrivateChannelsView, { props: { communikeyEvent: moderated() } });

    expect(screen.queryByTestId('concord-new-channel')).not.toBeNull();
  });

  it('renders nothing for a community with neither concord nor a root membership pointer', () => {
    holders.events = {};

    render(PrivateChannelsView, {
      props: {
        communikeyEvent: { kind: 10222, pubkey: OWNER, content: '', tags: [['d', 'relilab']] }
      }
    });

    expect(screen.queryAllByTestId('group-channel-row')).toHaveLength(0);
  });

  it('seeds the ?channel= deep link from the DISCOVERED subtree channels', async () => {
    // A subtree-discovered community has no legacy kind-10222 `group`
    // pointers, so a seeding pass that only reads those silently lands every
    // shared/toast channel link on the overview. The candidates must be the
    // same list the selection validator uses (root + discovered channels,
    // keys carrying the /c endpoint relay).
    clearGroupChannelSelection(OWNER);
    holders.pageUrl = 'https://app.example/c/relilab?channel=allgemein';
    holders.events = { [ENDPOINT]: [root(), chan('allgemein', [['private']])] };

    render(PrivateChannelsView, { props: { communikeyEvent: moderated() } });

    const chat = await screen.findByTestId('group-chat-stub', {}, { timeout: 4000 });
    expect(chat.textContent).toContain('allgemein');
  });
});
