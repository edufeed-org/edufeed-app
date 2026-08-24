/** @vitest-environment node */
/**
 * Being on a moderated community's root roster IS membership — the kind-30000
 * follow set should say so too.
 *
 * A 9021 join, an invite-code redemption and an admin-side role grant all end
 * the same way: the relay puts you in the root group's 39001/39002 and nothing
 * touches your `communities` follow set. So the community you belong to has no
 * rail entry until you separately press Follow, and until then its channels
 * show up as a loose relay tile instead (laoc, 2026-08-24).
 */
import { describe, it, expect } from 'vitest';
import { shouldFollowFromRoster } from '$lib/groups/community-follow.js';

const ME = 'e32efd27583706efaaccb595c1cf983f64ea7184eb8757d3a9d65aeec05e85bf';
const COMMUNITY = '1c5ff3caacd842c01dca8f378231b16617516d214da75c7aeabbe9e1efe9c0f6';
const ROOT = '0d55b35fba485756';

/** A moderated community: membership pointer, no concord pointer. */
const moderated = (pubkey = COMMUNITY) => ({
  kind: 10222,
  pubkey,
  tags: [['membership', ROOT, 'wss://groups.edufeed.org']]
});

/** @param {{members?: string[], isLoading?: boolean}} [opts] */
const roster = ({ members = [ME], isLoading = false } = {}) => ({
  members: new Set(members),
  isLoading,
  isMember: (/** @type {string} */ pubkey) => members.includes(pubkey)
});

/** @param {any} over */
const input = (over = {}) => ({
  communityEvent: moderated(),
  userPubkey: ME,
  roster: roster(),
  joinedCommunities: [],
  ...over
});

describe('shouldFollowFromRoster', () => {
  it('follows a moderated community whose root roster already holds me', () => {
    expect(shouldFollowFromRoster(input())).toBe(true);
  });

  // The reported case: laoc tester never sent a join — an admin granted the
  // publisher role, which lands in 39001 and unions into members.
  it('counts a role grant, not just a self-join', () => {
    const granted = roster({ members: [COMMUNITY, ME] });
    expect(shouldFollowFromRoster(input({ roster: granted }))).toBe(true);
  });

  it('does nothing when the roster has not answered yet', () => {
    expect(shouldFollowFromRoster(input({ roster: roster({ isLoading: true }) }))).toBe(false);
  });

  it('does nothing for someone the roster does not hold', () => {
    expect(shouldFollowFromRoster(input({ roster: roster({ members: [COMMUNITY] }) }))).toBe(false);
  });

  it('does nothing when the community is already followed', () => {
    expect(shouldFollowFromRoster(input({ joinedCommunities: [COMMUNITY] }))).toBe(false);
  });

  // Open communities have no root group to be a member OF; closed ones are
  // joined through Concord, not a follow set. Only moderated derives here.
  it('does nothing for a community that is not moderated', () => {
    const open = { kind: 10222, pubkey: COMMUNITY, tags: [['content', 'Learning']] };
    expect(shouldFollowFromRoster(input({ communityEvent: open }))).toBe(false);
  });

  // The community keypair is its own owner; following itself is meaningless.
  it('does nothing when the active account IS the community', () => {
    expect(shouldFollowFromRoster(input({ userPubkey: COMMUNITY }))).toBe(false);
  });

  it('survives a missing community, user or roster rather than throwing', () => {
    expect(shouldFollowFromRoster(input({ communityEvent: null }))).toBe(false);
    expect(shouldFollowFromRoster(input({ userPubkey: undefined }))).toBe(false);
    expect(shouldFollowFromRoster(input({ roster: null }))).toBe(false);
    expect(shouldFollowFromRoster(input({ joinedCommunities: null }))).toBe(true);
  });
});

/**
 * The hook adds two guards the pure rule cannot express, both about the
 * difference between "you follow nothing" and "the list has not loaded":
 *
 * 1. No follow-set event in the store → do nothing. Acting on an unloaded
 *    list is how a kind-30000 gets rebuilt from nothing.
 * 2. Once we have SEEN you following it, the pair is marked handled, so a
 *    deliberate unfollow later in the session is not undone.
 *
 * Both are asserted against the hook in
 * community-follow-reconcile.svelte.test.js; this suite keeps the pure rule
 * honest about the input it is handed.
 */
describe('shouldFollowFromRoster, unloaded-list caveat', () => {
  it('cannot tell an unloaded list from an empty one — the caller must', () => {
    // Documents WHY the hook checks the eventStore: from here both look the
    // same, and both say "follow".
    expect(shouldFollowFromRoster(input({ joinedCommunities: [] }))).toBe(true);
    expect(shouldFollowFromRoster(input({ joinedCommunities: null }))).toBe(true);
  });
});
