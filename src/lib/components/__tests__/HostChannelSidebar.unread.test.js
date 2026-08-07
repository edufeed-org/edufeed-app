/** @vitest-environment jsdom */
/**
 * Unread and mention state in the host channel sidebar — the wiring.
 *
 * A fake pool serves ONE host: the sidebar's own kind-9 subscription is under
 * test, so it is the only thing not mocked. Events are really signed and go
 * through a real applesauce EventStore, the same as GroupChat.test.js, because
 * a fake event the store silently drops would make every "is bold" assertion
 * pass on an empty timeline.
 *
 * Three defects this file exists to catch, none of which a pure test can see:
 *   - unread that resets on reconnect (markers must outlive the subscription);
 *   - "not heard from this host yet" rendered as "nothing unread";
 *   - marking read re-triggering the effect that reads the markers, which
 *     rebuilds the relay subscription on every channel you open.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';

const MY_SK = generateSecretKey();
const OTHER_SK = generateSecretKey();
const ME = getPublicKey(MY_SK);
const RELAY = 'wss://groups.example';
const KEY = (/** @type {string} */ id) => `${id}@wss://groups.example/`;

// Inside the unread window, which is measured from NOW. A fixed 2023 timestamp
// would sit outside every `since` the hook can compute, so the relay's answer
// would be filtered out before it reached the fold and every assertion about
// bolding would fail for a reason that has nothing to do with unread.
const T0 = Math.floor(Date.now() / 1000) - 3600;
const T1 = T0 + 100;
const T2 = T0 + 200;

/** @param {any} template @param {Uint8Array} sk */
const sign = (template, sk) =>
  finalizeEvent({ content: 'x', tags: [], created_at: T0, ...template }, sk);

/** @param {{id: string, at: number, sk?: Uint8Array, tags?: string[][]}} args */
const chat = ({ id, at, sk = OTHER_SK, tags = [] }) =>
  sign({ kind: 9, created_at: at, tags: [['h', id], ...tags] }, sk);

const holders = vi.hoisted(() => ({
  /** @type {any} */ directory: {
    metadata: [],
    ids: [],
    bySource: { listed: [], remembered: [], memberships: [] },
    authRequired: false,
    authRefused: null,
    loading: false
  },
  /** @type {any} */ relayInfo: { name: 'Beispiel-Relay', supported_nips: [29] },
  /** @type {any[]} */ myGroups: [],
  /** @type {any[]} */ subscribeCalls: [],
  /** @type {any[]} */ streams: [],
  /** @type {any} */ eventStore: null
}));

vi.mock('$lib/groups/relay-directory.svelte.js', () => ({
  useRelayDirectory: () => () => holders.directory
}));
vi.mock('$lib/groups/relay-information.svelte.js', () => ({
  useRelayInformation: () => () => holders.relayInfo
}));
vi.mock('$lib/groups/unlinked-groups.svelte.js', () => ({
  useMyGroups: () => () => holders.myGroups
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: ME })
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { EventStore } = await import('applesauce-core');
  await import('applesauce-common');
  const { Subject } = await import('rxjs');
  const eventStore = new EventStore();
  // applesauce's verifier does an instanceof Uint8Array that fails
  // CROSS-REALM under jsdom; the fixtures above are really signed.
  eventStore.verifyEvent = () => true;
  holders.eventStore = eventStore;
  return {
    eventStore,
    pool: {
      relay: () => ({
        subscription: (/** @type {any} */ filters) => {
          holders.subscribeCalls.push(filters);
          const stream = new Subject();
          holders.streams.push(stream);
          return stream;
        }
      })
    }
  };
});

import HostChannelSidebar from '$lib/components/groups/HostChannelSidebar.svelte';

/** kind:39000 as the measured Buzz relay emits it. */
const meta = (/** @type {string} */ id) => ({
  kind: 39000,
  tags: [
    ['d', id],
    ['name', id],
    ['t', 'stream']
  ]
});

const rowFor = (/** @type {string} */ name) =>
  screen.queryAllByTestId('host-channel-row').find((el) => el.textContent?.includes(name));

// Bolding lives on the NAME span, not on the row (ChannelRailRow: nameClass).
// Asserting on the row's own class would pass for free, and asserting on its
// innerHTML would count the mention pill's `font-bold` as bolding.
const nameClassOf = (/** @type {string} */ name) =>
  rowFor(name)?.querySelector('.truncate')?.className ?? '';

/** Messages only — the host has NOT said it is done sending. */
const send = async (/** @type {any[]} */ events) => {
  const stream = holders.streams.at(-1);
  for (const event of events) stream?.next(event);
  await waitFor(() => expect(screen.getAllByTestId('host-channel-row').length).toBeGreaterThan(0));
  await tick();
};

/** The newest emission this host has produced, then its end-of-stored-events. */
const serve = async (/** @type {any[]} */ events) => {
  await send(events);
  holders.streams.at(-1)?.next('EOSE');
  await waitFor(() => expect(screen.queryByTestId('host-sidebar-loading')).toBeNull());
};

beforeEach(() => {
  localStorage.clear();
  holders.directory = {
    metadata: [meta('allgemein'), meta('redesign')],
    ids: [],
    bySource: { listed: [], remembered: [], memberships: [] },
    authRequired: false,
    authRefused: null,
    loading: false
  };
  holders.relayInfo = { name: 'Beispiel-Relay', supported_nips: [29] };
  holders.myGroups = [];
  holders.subscribeCalls = [];
  holders.streams = [];
  // The store is a module singleton, so events from an earlier test stay in
  // it: fixtures are deterministic, so the same event id would be re-added and
  // a previous test's mention would still be on screen in this one.
  holders.eventStore?.removeByFilters?.({ kinds: [9] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('HostChannelSidebar unread', () => {
  it('asks the host for one kind-9 stream covering every channel it lists', async () => {
    render(HostChannelSidebar, { props: { relay: RELAY, activeChannelId: null } });

    await waitFor(() => expect(holders.subscribeCalls.length).toBe(1));
    const [filter] = holders.subscribeCalls[0];
    expect(filter.kinds).toEqual([9]);
    expect([...filter['#h']].sort()).toEqual(['allgemein', 'redesign']);
  });

  it('asks back to the oldest read marker, so a long-unread channel stays unread', async () => {
    const old = Math.floor(Date.now() / 1000) - 100_000;
    localStorage.setItem(
      'groups-unread:' + ME,
      JSON.stringify({ [KEY('allgemein')]: old, [KEY('redesign')]: old + 50_000 })
    );
    render(HostChannelSidebar, { props: { relay: RELAY, activeChannelId: null } });

    await waitFor(() => expect(holders.subscribeCalls.length).toBe(1));
    expect(holders.subscribeCalls[0][0].since).toBe(old);
  });

  it('shows no unread marks at all while the host has not answered', async () => {
    render(HostChannelSidebar, { props: { relay: RELAY, activeChannelId: null } });

    await waitFor(() => expect(screen.getAllByTestId('host-channel-row')).toHaveLength(2));
    // Not "nothing unread" — nothing KNOWN. Both must look the same to a
    // reader of this test only because they look the same on screen.
    expect(screen.queryByTestId('concord-unread-dot')).toBeNull();
    expect(screen.queryByTestId('host-mark-all-read')).toBeNull();
    expect(nameClassOf('allgemein')).not.toContain('font-bold');
  });

  it('holds its marks back until the host says it has finished sending', async () => {
    // The show-control for the test above: that one asserts nothing is drawn
    // with NO messages at all, which passes for free. This one has a real
    // unread message on the wire and still draws nothing, because the relay
    // has not sent EOSE — the difference between "nothing new" and "we have
    // not heard everything yet".
    render(HostChannelSidebar, { props: { relay: RELAY, activeChannelId: null } });
    await send([chat({ id: 'allgemein', at: T1 })]);

    expect(screen.queryByTestId('concord-unread-dot')).toBeNull();
    expect(screen.queryByTestId('host-mark-all-read')).toBeNull();
    expect(nameClassOf('allgemein')).not.toContain('font-bold');

    // ...and the same message, once the host has finished, does show.
    holders.streams.at(-1)?.next('EOSE');
    await waitFor(() => expect(screen.getAllByTestId('concord-unread-dot')).toHaveLength(1));
  });

  it('bolds and dots the channel with a message from someone else', async () => {
    render(HostChannelSidebar, { props: { relay: RELAY, activeChannelId: null } });
    await serve([chat({ id: 'allgemein', at: T1 })]);

    await waitFor(() => expect(screen.getAllByTestId('concord-unread-dot')).toHaveLength(1));
    expect(nameClassOf('allgemein')).toContain('font-bold');
    expect(nameClassOf('redesign')).not.toContain('font-bold');
  });

  it('raises a mention pill, not a dot, when a message p-tags me', async () => {
    render(HostChannelSidebar, { props: { relay: RELAY, activeChannelId: null } });
    await serve([chat({ id: 'allgemein', at: T1, tags: [['p', ME]] })]);

    await waitFor(() => expect(screen.getAllByTestId('concord-mention-pill')).toHaveLength(1));
    expect(screen.queryByTestId('concord-unread-dot')).toBeNull();
  });

  it('does not make a channel unread because of my own message', async () => {
    render(HostChannelSidebar, { props: { relay: RELAY, activeChannelId: null } });
    await serve([chat({ id: 'allgemein', at: T1, sk: MY_SK })]);

    expect(screen.queryByTestId('concord-unread-dot')).toBeNull();
    expect(nameClassOf('allgemein')).not.toContain('font-bold');
  });

  it('stamps the channel you have open as read, and leaves the others alone', async () => {
    render(HostChannelSidebar, { props: { relay: RELAY, activeChannelId: 'allgemein' } });
    await serve([chat({ id: 'allgemein', at: T1 }), chat({ id: 'redesign', at: T2 })]);

    await waitFor(() => expect(screen.getAllByTestId('concord-unread-dot')).toHaveLength(1));
    expect(nameClassOf('allgemein')).not.toContain('font-bold');
    expect(nameClassOf('redesign')).toContain('font-bold');
    expect(JSON.parse(localStorage.getItem('groups-unread:' + ME) ?? '{}')).toEqual({
      [KEY('allgemein')]: T1
    });
  });

  it('honours a marker written by an earlier session', async () => {
    localStorage.setItem('groups-unread:' + ME, JSON.stringify({ [KEY('allgemein')]: T1 }));
    render(HostChannelSidebar, { props: { relay: RELAY, activeChannelId: null } });
    await serve([chat({ id: 'allgemein', at: T1 })]);

    expect(screen.queryByTestId('concord-unread-dot')).toBeNull();
    expect(nameClassOf('allgemein')).not.toContain('font-bold');
  });

  it('reads the next channel you open, without waiting for a message in it', async () => {
    // Switching channels on one host stays on the same route, so the sidebar is
    // never unmounted and the subscription is never rebuilt — which is also why
    // nothing else can notice the switch. If the stamp only followed new
    // messages, the channel you just opened would sit there bold until someone
    // happened to post in it.
    const { rerender } = render(HostChannelSidebar, {
      props: { relay: RELAY, activeChannelId: 'allgemein' }
    });
    await serve([chat({ id: 'allgemein', at: T1 }), chat({ id: 'redesign', at: T2 })]);
    await waitFor(() => expect(screen.getAllByTestId('concord-unread-dot')).toHaveLength(1));

    await rerender({ relay: RELAY, activeChannelId: 'redesign' });

    await waitFor(() => expect(screen.queryByTestId('concord-unread-dot')).toBeNull());
    expect(JSON.parse(localStorage.getItem('groups-unread:' + ME) ?? '{}')).toEqual({
      [KEY('allgemein')]: T1,
      [KEY('redesign')]: T2
    });
  });

  it('catches the channel you are looking at up when you come back to the tab', async () => {
    // Suppressing the stamp while the tab is hidden is only half the rule.
    // Concord has both halves (notifications.svelte.js:353-359); without the
    // second one the channel on screen goes bold while you are away and STAYS
    // bold while you look straight at it, until the next message happens to
    // arrive. Nothing else re-runs the effect: returning to a tab changes no
    // rune, and `document.visibilityState` is a DOM property, not state.
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    render(HostChannelSidebar, { props: { relay: RELAY, activeChannelId: 'allgemein' } });
    await serve([chat({ id: 'allgemein', at: T1 })]);

    await waitFor(() => expect(screen.getAllByTestId('concord-unread-dot')).toHaveLength(1));
    expect(localStorage.getItem('groups-unread:' + ME)).toBeNull();

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(screen.queryByTestId('concord-unread-dot')).toBeNull());
    expect(JSON.parse(localStorage.getItem('groups-unread:' + ME) ?? '{}')).toEqual({
      [KEY('allgemein')]: T1
    });
    visibility.mockRestore();
  });

  it('does not rebuild the relay subscription when a channel is marked read', async () => {
    render(HostChannelSidebar, { props: { relay: RELAY, activeChannelId: 'allgemein' } });
    await serve([chat({ id: 'allgemein', at: T1 })]);
    await waitFor(() => expect(localStorage.getItem('groups-unread:' + ME)).toContain(String(T1)));

    // The marker read that decides `since` must not be a reactive dependency of
    // the effect that subscribes: it is written by the very act of opening a
    // channel, so a dependency here means a new REQ per open — and a stream
    // that restarts loses the unread it was carrying.
    expect(holders.subscribeCalls.length).toBe(1);
  });

  it('clears the whole host with mark all as read', async () => {
    render(HostChannelSidebar, { props: { relay: RELAY, activeChannelId: null } });
    await serve([chat({ id: 'allgemein', at: T1 }), chat({ id: 'redesign', at: T2 })]);
    await waitFor(() => expect(screen.getAllByTestId('concord-unread-dot')).toHaveLength(2));

    await fireEvent.click(screen.getByTestId('host-mark-all-read'));

    await waitFor(() => expect(screen.queryByTestId('concord-unread-dot')).toBeNull());
    expect(screen.queryByTestId('host-mark-all-read')).toBeNull();
    expect(JSON.parse(localStorage.getItem('groups-unread:' + ME) ?? '{}')).toEqual({
      [KEY('allgemein')]: T1,
      [KEY('redesign')]: T2
    });
  });
});
