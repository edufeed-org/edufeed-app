/** @vitest-environment jsdom */
/**
 * HostChannelSidebar — the column that makes one channel of a host into all of
 * them.
 *
 * Only the two hooks that open relay subscriptions are faked (the directory
 * and NIP-11). The merge under test — real useHostChannels, real
 * buildChannelRows, real splitChannelSections — runs, because a hand-written
 * row list could describe a state the builder never produces, and the thing
 * that broke before was the WIRING, not the rules.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const RELAY = 'wss://groups.example';

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
  /** @type {any[]} */ askedRelays: []
}));

vi.mock('$lib/groups/relay-directory.svelte.js', () => ({
  useRelayDirectory: (/** @type {() => any} */ getRelay) => {
    holders.askedRelays.push(getRelay);
    return () => holders.directory;
  }
}));
vi.mock('$lib/groups/relay-information.svelte.js', () => ({
  useRelayInformation: () => () => holders.relayInfo
}));
vi.mock('$lib/groups/unlinked-groups.svelte.js', () => ({
  useMyGroups: () => () => holders.myGroups
}));

import HostChannelSidebar from '$lib/components/groups/HostChannelSidebar.svelte';

/** kind:39000 as the measured Buzz relay emits it. */
const meta = (/** @type {string} */ id, /** @type {string[][]} */ extra = []) => ({
  kind: 39000,
  tags: [['d', id], ...extra]
});

const rowNames = () =>
  screen
    .queryAllByTestId('host-channel-row')
    .map((el) => el.textContent?.trim().replace(/\s+/g, ' '));

beforeEach(() => {
  holders.directory = {
    metadata: [],
    ids: [],
    bySource: { listed: [], remembered: [], memberships: [] },
    authRequired: false,
    authRefused: null,
    loading: false
  };
  holders.relayInfo = { name: 'Beispiel-Relay', supported_nips: [29] };
  holders.myGroups = [];
  holders.askedRelays = [];
});

describe('HostChannelSidebar', () => {
  it('lists every channel the host has, not just the one you opened', () => {
    holders.directory.metadata = [
      meta('allgemein', [
        ['name', 'allgemein'],
        ['t', 'stream']
      ]),
      meta('redesign', [
        ['name', 'redesign'],
        ['t', 'stream']
      ]),
      meta('nips', [
        ['name', 'NIPs'],
        ['t', 'stream']
      ])
    ];
    render(HostChannelSidebar, { props: { relay: RELAY, activeChannelId: 'redesign' } });

    const rows = screen.getAllByTestId('host-channel-row');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.getAttribute('href'))).toEqual([
      "/groups/groups.example'allgemein",
      "/groups/groups.example'nips",
      "/groups/groups.example'redesign"
    ]);
  });

  // The whole point of the column: the row you are reading is the marked one.
  it('marks the channel that is open, and only that one', () => {
    holders.directory.metadata = [
      meta('allgemein', [['name', 'allgemein']]),
      meta('redesign', [['name', 'redesign']])
    ];
    render(HostChannelSidebar, { props: { relay: RELAY, activeChannelId: 'redesign' } });

    const marked = screen
      .getAllByTestId('host-channel-row')
      .filter((r) => r.getAttribute('aria-current') === 'page');
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain('redesign');
  });

  it('marks nothing on a directory route, where no channel is open', () => {
    holders.directory.metadata = [meta('allgemein', [['name', 'allgemein']])];
    render(HostChannelSidebar, { props: { relay: RELAY } });
    expect(
      screen.getAllByTestId('host-channel-row').filter((r) => r.getAttribute('aria-current'))
    ).toHaveLength(0);
  });

  it('gives direct messages their own section', () => {
    holders.directory.metadata = [
      meta('allgemein', [
        ['name', 'allgemein'],
        ['t', 'stream']
      ]),
      meta('dm-1', [['name', 'DM'], ['t', 'dm'], ['private'], ['hidden']])
    ];
    render(HostChannelSidebar, { props: { relay: RELAY } });

    expect(screen.getByTestId('host-sidebar-section-channels')).toBeTruthy();
    expect(screen.getByTestId('host-sidebar-section-dms')).toBeTruthy();
    // Sections, not one flat list: the DM is the LAST row, under its own
    // heading, even though 'DM' sorts before 'allgemein' nowhere near it.
    expect(rowNames()?.at(-1)).toContain('DM');
  });

  // Most hosts do not use the `t` convention at all. An empty "Direct
  // messages" heading would be a section we invented.
  it('has no direct-message section on a host that names none', () => {
    holders.directory.metadata = [meta('allgemein', [['name', 'allgemein']])];
    render(HostChannelSidebar, { props: { relay: RELAY } });
    expect(screen.getByTestId('host-sidebar-section-channels')).toBeTruthy();
    expect(screen.queryByTestId('host-sidebar-section-dms')).toBeNull();
  });

  // A refusal is the relay's own sentence. An empty column with no reason is
  // the failure this whole surface keeps walking into.
  it('says why the list is empty when the relay refuses us', () => {
    holders.directory.authRefused = 'restricted: not a relay member';
    render(HostChannelSidebar, { props: { relay: RELAY } });
    expect(screen.getByTestId('host-sidebar-auth-refused').textContent).toContain(
      'restricted: not a relay member'
    );
    expect(screen.queryByTestId('host-sidebar-empty')).toBeNull();
  });

  it('distinguishes a host that has not answered yet from an empty one', () => {
    holders.directory.loading = true;
    const { unmount } = render(HostChannelSidebar, { props: { relay: RELAY } });
    expect(screen.getByTestId('host-sidebar-loading')).toBeTruthy();
    unmount();

    holders.directory.loading = false;
    render(HostChannelSidebar, { props: { relay: RELAY } });
    expect(screen.getByTestId('host-sidebar-empty')).toBeTruthy();
  });

  // The header is the way back to the full directory, and it carries the
  // host's own name from its NIP-11 document — not the bare address.
  it("heads the column with the host's own name, linking back to its directory", () => {
    render(HostChannelSidebar, { props: { relay: RELAY } });
    const header = screen.getByTestId('host-sidebar-header');
    expect(header.textContent).toContain('Beispiel-Relay');
    expect(header.getAttribute('href')).toBe(`/relays/${encodeURIComponent(RELAY)}`);
  });

  it('asks the directory for the relay it was given', () => {
    render(HostChannelSidebar, { props: { relay: RELAY } });
    expect(holders.askedRelays.map((get) => get())).toContain(RELAY);
  });
});
