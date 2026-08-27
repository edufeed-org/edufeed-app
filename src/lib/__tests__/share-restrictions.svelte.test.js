/* eslint-disable no-undef -- $effect/$state are Svelte runes, available in .svelte.test.js context */
/** @vitest-environment jsdom */
/**
 * useShareRestrictions — which communities in a share picker would swallow
 * the user's share. Three gate paths now meet here, and the rule they all
 * obey is the same: mark restricted only on positive evidence, fail OPEN on
 * anything missing or still loading.
 *
 * The case that motivated this file: laoc tester held role `publisher` in
 * laoc42's root group and had to come out UNrestricted (2026-08-21).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

const COMMUNITY = '1'.repeat(64);
const PUBLISHER = '2'.repeat(64);
const OUTSIDER = '3'.repeat(64);
const ADMIN = '4'.repeat(64);
const GROUP_ID = '0d55b35fba485756';
const GROUPS_RELAY = 'wss://groups.example/';

const holders = vi.hoisted(() => ({
  /** @type {any} */ eventStore: null,
  /** @type {any} */ activeUser: null,
  /** @type {any} */ rosters: null
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { EventStore } = await import('applesauce-core');
  const eventStore = new EventStore();
  eventStore.verifyEvent = () => true;
  holders.eventStore = eventStore;
  return { eventStore, pool: { relay: () => ({ request: () => ({ subscribe: () => ({}) }) }) } };
});

vi.mock('$lib/loaders/base.js', async () => {
  const { of } = await import('rxjs');
  return { addressLoader: () => of(), timedPool: () => of() };
});
vi.mock('applesauce-loaders/loaders', async () => {
  const { of } = await import('rxjs');
  return { createTimelineLoader: () => () => of() };
});
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => ['wss://communikey.example/'],
  getAllLookupRelays: () => []
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => holders.activeUser }));
// The roster loader itself is covered by channel-rosters.svelte.test.js;
// here it is a fixture so the gate logic is what's under test.
vi.mock('$lib/groups/channel-rosters.svelte.js', () => ({
  useChannelRosters: () => () => holders.rosters
}));

const { useShareRestrictions } = await import('$lib/stores/share-restrictions.svelte.js');
const { channelKey } = await import('$lib/groups/community-pointer.js');

const KEY = /** @type {string} */ (channelKey({ id: GROUP_ID, relay: GROUPS_RELAY }));

/** A moderated community whose Learning section is publisher-gated. */
const gatedCommunity = (created_at = 1000) => ({
  kind: 10222,
  pubkey: COMMUNITY,
  id: 'c'.repeat(64),
  created_at,
  content: '',
  sig: 'x'.repeat(128),
  tags: [
    ['membership', GROUP_ID, GROUPS_RELAY],
    ['strict', 'content'],
    ['content', 'Learning'],
    ['access', 'role', 'publisher'],
    ['k', '30142']
  ]
});

/** The same community with an UNgated Learning section. */
const openCommunity = (created_at = 1000) => ({
  ...gatedCommunity(created_at),
  id: 'e'.repeat(64),
  tags: [
    ['membership', GROUP_ID, GROUPS_RELAY],
    ['strict', 'content'],
    ['content', 'Learning'],
    ['k', '30142']
  ]
});

/** An admin's kind-30223 that publisher-gates Learning. */
const override = (author = ADMIN, created_at = 5000) => ({
  kind: 30223,
  pubkey: author,
  id: 'd'.repeat(64),
  created_at,
  content: '',
  sig: 'x'.repeat(128),
  tags: [
    ['d', COMMUNITY],
    ['h', COMMUNITY],
    ['content', 'Learning'],
    ['k', '30142'],
    ['access', 'role', 'publisher']
  ]
});

/** @param {{loading?: boolean}} [opts] */
const rosterFixture = ({ loading = false } = {}) => ({
  membersByKey: loading ? {} : { [KEY]: new Set([PUBLISHER, ADMIN]) },
  adminsByKey: loading
    ? {}
    : {
        [KEY]: [
          { pubkey: ADMIN, roles: ['admin'] },
          { pubkey: COMMUNITY, roles: ['admin'] },
          { pubkey: PUBLISHER, roles: ['publisher'] }
        ]
      },
  fetchedKeys: loading ? new Set() : new Set([KEY]),
  refresh: () => {}
});

function mount() {
  /** @type {() => Set<string>} */
  let getRestricted;
  const cleanup = $effect.root(() => {
    getRestricted = useShareRestrictions(
      () => 30142,
      () => [COMMUNITY]
    );
  });
  flushSync();
  // @ts-expect-error assigned inside effect.root
  return { getRestricted, cleanup };
}

beforeEach(() => {
  holders.activeUser = { pubkey: PUBLISHER };
  holders.rosters = rosterFixture();
  // Replaceable events are keyed by (kind, pubkey, d) and a same-timestamp
  // add is a no-op, so a leaked 10222 from an earlier case would silently
  // win over this one's fixture. Clear both kinds explicitly.
  holders.eventStore?.removeByFilters?.({ kinds: [10222, 30223] });
  holders.eventStore?.database?.clear?.();
});

describe('useShareRestrictions — roster gate', () => {
  it('a publisher is NOT restricted on a publisher-gated section', () => {
    holders.eventStore.add(gatedCommunity());
    const { getRestricted, cleanup } = mount();
    expect(getRestricted().has(COMMUNITY)).toBe(false);
    cleanup();
  });

  it('a roster member without the role IS restricted', () => {
    holders.activeUser = { pubkey: ADMIN };
    holders.rosters = {
      ...rosterFixture(),
      adminsByKey: { [KEY]: [{ pubkey: ADMIN, roles: ['moderator'] }] }
    };
    holders.eventStore.add(gatedCommunity());
    const { getRestricted, cleanup } = mount();
    expect(getRestricted().has(COMMUNITY)).toBe(true);
    cleanup();
  });

  it('an outsider IS restricted', () => {
    holders.activeUser = { pubkey: OUTSIDER };
    holders.eventStore.add(gatedCommunity());
    const { getRestricted, cleanup } = mount();
    expect(getRestricted().has(COMMUNITY)).toBe(true);
    cleanup();
  });

  it('fails OPEN while the roster is still loading', () => {
    // Greying out a legitimate publisher on slow roster data is worse than
    // briefly offering a row we later disable.
    holders.activeUser = { pubkey: OUTSIDER };
    holders.rosters = rosterFixture({ loading: true });
    holders.eventStore.add(gatedCommunity());
    const { getRestricted, cleanup } = mount();
    expect(getRestricted().has(COMMUNITY)).toBe(false);
    cleanup();
  });

  it('an ungated section restricts nobody', () => {
    holders.activeUser = { pubkey: OUTSIDER };
    holders.eventStore.add(openCommunity());
    const { getRestricted, cleanup } = mount();
    expect(getRestricted().has(COMMUNITY)).toBe(false);
    cleanup();
  });
});

describe('useShareRestrictions — kind-30223 section override', () => {
  it('honours a gate that exists ONLY in an admin override', () => {
    // The picker must gate on the same sections the FAB and the community
    // page do; reading the owner's raw 10222 here left this row wide open.
    holders.activeUser = { pubkey: OUTSIDER };
    holders.eventStore.add(openCommunity());
    holders.eventStore.add(override());
    const { getRestricted, cleanup } = mount();
    expect(getRestricted().has(COMMUNITY)).toBe(true);
    cleanup();
  });

  it('still lets the publisher through that same override', () => {
    holders.activeUser = { pubkey: PUBLISHER };
    holders.eventStore.add(openCommunity());
    holders.eventStore.add(override());
    const { getRestricted, cleanup } = mount();
    expect(getRestricted().has(COMMUNITY)).toBe(false);
    cleanup();
  });

  it('ignores an override from a non-admin', () => {
    // Anyone can publish a 30223 to a relay; only a current 39001 admin (or
    // the community key) may speak for the community's sections.
    holders.activeUser = { pubkey: OUTSIDER };
    holders.eventStore.add(openCommunity());
    holders.eventStore.add(override(OUTSIDER));
    const { getRestricted, cleanup } = mount();
    expect(getRestricted().has(COMMUNITY)).toBe(false);
    cleanup();
  });

  it('an override that OPENS a section the owner gated lets everyone through', () => {
    holders.activeUser = { pubkey: OUTSIDER };
    holders.eventStore.add(gatedCommunity());
    holders.eventStore.add({
      ...override(),
      tags: [
        ['d', COMMUNITY],
        ['content', 'Learning'],
        ['k', '30142']
      ]
    });
    const { getRestricted, cleanup } = mount();
    expect(getRestricted().has(COMMUNITY)).toBe(false);
    cleanup();
  });
});
