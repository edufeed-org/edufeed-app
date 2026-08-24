// @ts-nocheck
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
/** @vitest-environment jsdom */
/**
 * The two guards the pure rule cannot express, both turning on the difference
 * between "you follow nothing" and "your follow set has not loaded yet".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';

const ME = 'e'.repeat(64);
const COMMUNITY = '1'.repeat(64);
const ROOT = '0d55b35fba485756';

let joinedCommunities;
let rosterMembers;
let followSetInStore;
const joinCommunityMock = vi.fn(async () => ({ success: true }));

vi.mock('$lib/helpers/community.js', () => ({
  joinCommunity: (...args) => joinCommunityMock(...args)
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: ME, signer: {} })
}));
vi.mock('$lib/stores/joined-communities-list.svelte.js', () => ({
  useJoinedCommunitiesList: () => () => joinedCommunities
}));
vi.mock('$lib/groups/root-roster.svelte.js', () => ({
  useRootRoster: () => () => ({
    isLoading: false,
    members: new Set(rosterMembers),
    isMember: (pubkey) => rosterMembers.includes(pubkey)
  })
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { getReplaceable: () => (followSetInStore ? { kind: 30000 } : undefined) }
}));

const moderated = {
  kind: 10222,
  pubkey: COMMUNITY,
  tags: [['membership', ROOT, 'wss://groups.edufeed.org']]
};

describe('useCommunityFollowReconcile', () => {
  let useCommunityFollowReconcile;
  let reset;
  let cleanup;

  beforeEach(async () => {
    joinedCommunities = [];
    rosterMembers = [ME];
    followSetInStore = true;
    joinCommunityMock.mockClear();
    const mod = await import('$lib/groups/community-follow-reconcile.svelte.js');
    useCommunityFollowReconcile = mod.useCommunityFollowReconcile;
    reset = mod.__resetCommunityFollowReconcile;
    reset();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  const run = (getEvent = () => moderated) => {
    cleanup = $effect.root(() => useCommunityFollowReconcile(getEvent));
    flushSync();
  };

  it('follows a community whose root roster already holds me', () => {
    run();
    expect(joinCommunityMock).toHaveBeenCalledWith(COMMUNITY);
  });

  // The follow-set wipe class of bug: an unloaded kind-30000 reads as "you
  // follow nothing", and rebuilding it from nothing loses every other
  // community. Absence of the event is the only honest signal we have.
  it('does nothing while the follow set is not in the store', () => {
    followSetInStore = false;
    run();
    expect(joinCommunityMock).not.toHaveBeenCalled();
  });

  it('does nothing for someone the roster does not hold', () => {
    rosterMembers = [];
    run();
    expect(joinCommunityMock).not.toHaveBeenCalled();
  });

  it('follows at most once per community per session', () => {
    run();
    cleanup();
    cleanup = undefined;
    run();
    expect(joinCommunityMock).toHaveBeenCalledTimes(1);
  });

  // Having SEEN the follow marks the pair handled, so unfollowing later in the
  // same session is not undone on the spot — which would make the Unfollow
  // button look broken.
  it('does not undo a deliberate unfollow made in the same session', () => {
    joinedCommunities = [COMMUNITY];
    run();
    expect(joinCommunityMock).not.toHaveBeenCalled();

    cleanup();
    cleanup = undefined;
    joinedCommunities = []; // the user pressed Unfollow
    run();
    expect(joinCommunityMock).not.toHaveBeenCalled();
  });
});
