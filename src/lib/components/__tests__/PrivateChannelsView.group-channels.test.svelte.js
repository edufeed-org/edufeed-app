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
vi.mock(
  '$lib/components/groups/call/ChannelCallRoster.svelte',
  () => import('./fixtures/ChannelCallRosterStub.svelte')
);
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
  pageUrl: /** @type {string | null} */ (null),
  /** @type {Set<(value: any) => void>} live page-store subscribers */
  pageSubscribers: new Set()
}));

// Reactive page mock: deep links must also work while the component stays
// mounted (a query-only goto never remounts it), so tests can push a NEW
// URL to every live subscriber via setPageUrl.
const pageValue = () => (holders.pageUrl ? { url: new URL(holders.pageUrl) } : {});
/** @param {string} url */
function setPageUrl(url) {
  holders.pageUrl = url;
  for (const cb of holders.pageSubscribers) cb(pageValue());
}
vi.mock('$app/stores', () => ({
  page: {
    subscribe: (/** @type {any} */ cb) => {
      holders.pageSubscribers.add(cb);
      cb(pageValue());
      return () => holders.pageSubscribers.delete(cb);
    }
  }
}));

const gotoMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
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
import {
  clearGroupChannelSelection,
  requestChannelList
} from '$lib/groups/group-channel-selection.svelte.js';
import { flushSync } from 'svelte';
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
  holders.pageSubscribers.clear();
  gotoMock.mockClear();
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

  // Below lg this rail IS the channel list: a running call shows here the
  // same way it does in the desktop sidebar (laoc, 2026-10-02) — and only AV
  // channels open a presence subscription.
  it('draws the call roster under AV channels only, and its Join opens that channel', async () => {
    holders.events = {
      [ENDPOINT]: [root(), chan('sprechstunde', [['livekit']]), chan('allgemein', [['private']])]
    };

    render(PrivateChannelsView, { props: { communikeyEvent: moderated() } });

    await screen.findAllByTestId('group-channel-row');
    const rosters = await screen.findAllByTestId('channel-call-roster-stub');
    expect(rosters.map((r) => r.textContent)).toEqual(['sprechstunde']);
    await fireEvent.click(rosters[0]);
    const chat = await screen.findByTestId('group-chat-stub');
    expect(chat.textContent).toContain('sprechstunde');
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

  it('clicking a group rail row mirrors the channel into ?channel=', async () => {
    holders.events = { [ENDPOINT]: [root(), chan('allgemein', [['private']])] };

    render(PrivateChannelsView, { props: { communikeyEvent: moderated() } });

    const rows = await screen.findAllByTestId('group-channel-row');
    const row = /** @type {HTMLElement} */ (rows.find((r) => r.textContent?.includes('allgemein')));
    await fireEvent.click(row);

    // The room must be linkable from the address bar (issue: deep links to a
    // specific room) — a rail click that only writes the selection store
    // would leave the URL pointing at the overview.
    expect(gotoMock).toHaveBeenCalledWith(
      expect.stringContaining('channel=allgemein'),
      expect.anything()
    );
  });

  it('a ?channel= change AFTER mount switches the selection', async () => {
    clearGroupChannelSelection(OWNER);
    holders.pageUrl = 'https://app.example/c/relilab?channel=allgemein';
    holders.events = {
      [ENDPOINT]: [root(), chan('allgemein', [['private']]), chan('zweiter', [['private']])]
    };

    render(PrivateChannelsView, { props: { communikeyEvent: moderated() } });

    const chat = await screen.findByTestId('group-chat-stub', {}, { timeout: 4000 });
    expect(chat.textContent).toContain('allgemein');

    // A shared message link clicked inside the app is a query-only goto —
    // the component stays mounted, so the deep link must be applied
    // reactively, not by a one-shot mount effect.
    setPageUrl('https://app.example/c/relilab?channel=zweiter');
    await vi.waitFor(() => {
      expect(screen.getByTestId('group-chat-stub').textContent).toContain('zweiter');
    });
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
  // Design 1a (laoc, 2026-10-02): the way back is GroupChat's own "‹ Kanäle"
  // breadcrumb on every width, so the pane passes onBack and draws no
  // mobile-only back button of its own.
  describe('way back to the channel list', () => {
    /** @param {{ container: HTMLElement }} view */
    const rail = (view) => /** @type {HTMLElement} */ (view.container.querySelector('aside'));

    async function openAllgemein() {
      clearGroupChannelSelection(OWNER);
      holders.events = { [ENDPOINT]: [root(), chan('allgemein', [['private']])] };
      const view = render(PrivateChannelsView, { props: { communikeyEvent: moderated() } });
      const rows = await screen.findAllByTestId('group-channel-row');
      await fireEvent.click(
        /** @type {HTMLElement} */ (rows.find((r) => r.textContent?.includes('allgemein')))
      );
      await screen.findByTestId('group-chat-stub');
      return view;
    }

    it('hands GroupChat an onBack and renders no separate back button', async () => {
      await openAllgemein();
      expect(screen.queryByTestId('group-chat-back')).toBeNull();
      expect(screen.getByTestId('group-chat-stub-back')).toBeTruthy();
    });

    it('the breadcrumb clears the selection: overview + rail again, ?channel= dropped', async () => {
      const view = await openAllgemein();
      expect(rail(view).className).toContain('hidden');
      gotoMock.mockClear();

      await fireEvent.click(screen.getByTestId('group-chat-stub-back'));

      await vi.waitFor(() => expect(screen.queryByTestId('group-chat-stub')).toBeNull());
      expect(rail(view).className.split(/\s+/)).not.toContain('hidden');
      expect(gotoMock).toHaveBeenCalledWith(
        expect.not.stringContaining('channel='),
        expect.anything()
      );
    });

    // The URL update is async (goto): the cleared selection re-runs the
    // ?channel= deep-link effect while the old param is still in the address
    // bar — it must not re-open the channel from it.
    it('going back from a deep-linked channel stays back; the same link applies again later', async () => {
      clearGroupChannelSelection(OWNER);
      holders.pageUrl = 'https://app.example/c/relilab?view=channels&channel=allgemein';
      holders.events = { [ENDPOINT]: [root(), chan('allgemein', [['private']])] };
      render(PrivateChannelsView, { props: { communikeyEvent: moderated() } });
      await screen.findByTestId('group-chat-stub', {}, { timeout: 4000 });

      await fireEvent.click(screen.getByTestId('group-chat-stub-back'));
      // Any re-run of the effect before goto lands (here: a page-store
      // emission still carrying the old ?channel=) must not re-open it.
      setPageUrl('https://app.example/c/relilab?view=channels&channel=allgemein');
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByTestId('group-chat-stub')).toBeNull();

      setPageUrl('https://app.example/c/relilab?view=channels');
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByTestId('group-chat-stub')).toBeNull();

      setPageUrl('https://app.example/c/relilab?view=channels&channel=allgemein');
      await screen.findByTestId('group-chat-stub');
    });

    it('a re-tap of the Kanäle tab (requestChannelList) goes back to the list', async () => {
      const view = await openAllgemein();

      requestChannelList(OWNER);
      flushSync();

      await vi.waitFor(() => expect(screen.queryByTestId('group-chat-stub')).toBeNull());
      expect(rail(view).className.split(/\s+/)).not.toContain('hidden');
    });
  });
});
