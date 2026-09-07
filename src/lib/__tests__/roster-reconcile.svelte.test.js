// @ts-nocheck
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
/** @vitest-environment jsdom */
/**
 * The publisher→admin escalation bug (issue "Role mapping: edufeed Publisher
 * shows up as Admin in Armada"): the reconcile fan-out treated EVERY root
 * kind-39001 entry as an admin, put-user'ing publisher-only members with the
 * literal 'admin' role on each channel — which the pyramid relay honours as
 * real moderation rights. The hook must fan out moderation-role holders
 * only, and revert the admin grants the bug already wrote.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { channelKey } from '$lib/groups/community-pointer.js';

const ADMIN = 'a'.repeat(64);
const PUB = 'b'.repeat(64);
const COMMUNITY = '1'.repeat(64);
const RELAY = 'wss://groups.example/';
const CHAN = { id: 'chan1', relay: RELAY };
const CHAN_KEY = channelKey(CHAN);

let rootRoster;
let membersByKey;
let adminsByKey;
let activeUser;
const putUserOnMock = vi.fn(async () => {});

vi.mock('$lib/groups/root-roster.svelte.js', () => ({
  useRootRoster: () => () => rootRoster
}));
vi.mock('$lib/groups/channel-rosters.svelte.js', () => ({
  useChannelRosters: () => () => ({
    membersByKey,
    adminsByKey,
    fetchedKeys: new Set(),
    refresh: () => {}
  })
}));
vi.mock('$lib/groups/community-channels.svelte.js', () => ({
  useCommunityChannels: () => () => ({ channels: [CHAN] })
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => activeUser
}));
vi.mock('$lib/helpers/community-signer.js', () => ({
  isCommunityOwner: () => false
}));
vi.mock('$lib/groups/roster-fanout.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, putUserOn: (...args) => putUserOnMock(...args) };
});

const communikeyEvent = { kind: 10222, pubkey: COMMUNITY, tags: [] };

describe('useRosterReconcile', () => {
  let useRosterReconcile;
  let cleanup;

  beforeEach(async () => {
    putUserOnMock.mockClear();
    activeUser = { pubkey: ADMIN, signer: {} };
    rootRoster = {
      pointer: { id: 'root1', relay: RELAY },
      isLoading: false,
      admins: [
        { pubkey: ADMIN, roles: ['admin'] },
        { pubkey: PUB, roles: ['publisher'] }
      ]
    };
    membersByKey = { [CHAN_KEY]: new Set() };
    adminsByKey = { [CHAN_KEY]: [] };
    const mod = await import('$lib/groups/roster-reconcile.svelte.js');
    useRosterReconcile = mod.useRosterReconcile;
    mod.__resetRosterReconcile();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  const run = () => {
    cleanup = $effect.root(() => useRosterReconcile(() => communikeyEvent));
    flushSync();
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('fans the admin role out to moderation-role holders only — never to publishers', async () => {
    run();
    await settle();
    const puttedAsAdmin = putUserOnMock.mock.calls.map(([, pubkey]) => pubkey);
    expect(puttedAsAdmin).toContain(ADMIN);
    expect(puttedAsAdmin).not.toContain(PUB);
  });

  it('reverts an admin grant the bug already wrote for a publisher-only entry', async () => {
    adminsByKey = {
      [CHAN_KEY]: [
        { pubkey: ADMIN, roles: ['admin'] },
        { pubkey: PUB, roles: ['admin'] }
      ]
    };
    run();
    await settle();
    const demote = putUserOnMock.mock.calls.find(([, pubkey]) => pubkey === PUB);
    expect(demote).toBeDefined();
    expect(demote[2]).toEqual([]); // moderation roles stripped, plain member
  });

  it('a publisher-only active user has no channel-admin rights and must not act', async () => {
    activeUser = { pubkey: PUB, signer: {} };
    run();
    await settle();
    expect(putUserOnMock).not.toHaveBeenCalled();
  });
});
