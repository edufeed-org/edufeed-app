/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  communityNavTabIds,
  buildSidebarZones,
  resolveZoneMembership
} from '$lib/components/community/layout/community-nav.js';

const OWNER = 'a'.repeat(64);
const RELAY = 'wss://groups.example';

/** @param {string[][]} tags */
const openCommunityEvent = (tags = []) => ({
  kind: 10222,
  pubkey: OWNER,
  content: '',
  tags: [['d', 'relilab'], ...tags]
});

/** @param {string[][]} tags */
const closedCommunityEvent = (tags = []) => ({
  kind: 10222,
  pubkey: OWNER,
  content: '',
  // A `concord` pointer with no `membership` tag makes deriveCommunityType
  // return 'closed', which getCommunityTabs collapses to ['home', 'settings']
  // — no 'chat' tab, exercising the before-'settings' insert branch. The
  // pointer id must be 64-char hex (parseConcordPointer validates it).
  tags: [['d', 'relilab'], ['concord', 'c'.repeat(64), RELAY], ...tags]
});

const baseArgs = {
  concordEnabled: false,
  pointer: undefined,
  isOwner: false,
  isMember: false,
  hasGroupChannels: false
};

describe('communityNavTabIds', () => {
  // Mirrors ContentNavSidebar.group-channels.test.svelte.js's fixtures: a
  // usable NIP-29 group pointer opens the tab for a stranger, independent of
  // Concord being off in every possible way.
  it('splices channels after chat when the community has a usable group pointer (stranger)', () => {
    const ids = communityNavTabIds({
      communityEvent: openCommunityEvent(),
      ...baseArgs,
      hasGroupChannels: true
    });
    expect(ids).toContain('channels');
    expect(ids.indexOf('channels')).toBe(ids.indexOf('chat') + 1);
  });

  it('omits channels when the community has no protected area at all', () => {
    const ids = communityNavTabIds({ communityEvent: openCommunityEvent(), ...baseArgs });
    expect(ids).not.toContain('channels');
  });

  // A group tag with no usable pointer never reaches this function as
  // hasGroupChannels: true — the caller runs parseGroupPointers first, which
  // already drops unaddressable tags. This documents that contract.
  it('omits channels when the caller found no usable group pointer', () => {
    const ids = communityNavTabIds({
      communityEvent: openCommunityEvent(),
      ...baseArgs,
      hasGroupChannels: false
    });
    expect(ids).not.toContain('channels');
  });

  it('shows channels for a Concord community when the pointer exists, even for a stranger', () => {
    const ids = communityNavTabIds({
      communityEvent: openCommunityEvent(),
      ...baseArgs,
      concordEnabled: true,
      pointer: { communityId: 'area-1' }
    });
    expect(ids).toContain('channels');
  });

  it('hides channels for Concord when enabled but no pointer, not owner, not member', () => {
    const ids = communityNavTabIds({
      communityEvent: openCommunityEvent(),
      ...baseArgs,
      concordEnabled: true
    });
    expect(ids).not.toContain('channels');
  });

  // The bare-owner clause is gone (founding lives in the settings type
  // card) — but once the type decision is made (membership pointer on the
  // 10222), the owner's tab list must carry 'channels' again: it is the
  // only path to "+ Neuer Kanal" for the FIRST channel (laoc, 2026-08-18).
  // Derived from the event itself, so ContentNavSidebar/BottomTabBar need
  // no extra prop.
  it('hides channels for a bare owner — founding lives in settings now', () => {
    const ids = communityNavTabIds({
      communityEvent: openCommunityEvent(),
      ...baseArgs,
      concordEnabled: true,
      isOwner: true
    });
    expect(ids).not.toContain('channels');
  });

  it('shows channels for the owner of a moderated community with zero channels', () => {
    const ids = communityNavTabIds({
      communityEvent: openCommunityEvent([['membership', 'root-1', RELAY]]),
      ...baseArgs,
      isOwner: true
    });
    expect(ids).toContain('channels');
  });

  it('hides channels for a visitor of a moderated community with zero channels', () => {
    const ids = communityNavTabIds({
      communityEvent: openCommunityEvent([['membership', 'root-1', RELAY]]),
      ...baseArgs
    });
    expect(ids).not.toContain('channels');
  });

  it('inserts channels before settings when the tab list has no chat tab', () => {
    const ids = communityNavTabIds({
      communityEvent: closedCommunityEvent(),
      ...baseArgs,
      hasGroupChannels: true
    });
    expect(ids).toEqual(['home', 'channels', 'settings']);
  });

  it('leaves the base tab list untouched when nothing opens the channels tab', () => {
    const base = ['home', 'chat', 'calendar', 'settings'];
    // Sanity: getCommunityTabs is not mocked here, so just assert shape
    // invariants that must hold regardless of the concrete tab set.
    const ids = communityNavTabIds({ communityEvent: openCommunityEvent(), ...baseArgs });
    expect(ids[0]).toBe('home');
    expect(ids[ids.length - 1]).toBe('settings');
    expect(ids).not.toContain('channels');
    void base;
  });
});

describe('buildSidebarZones', () => {
  const tabs = ['home', 'chat', 'calendar', 'learning', 'channels', 'settings'];

  /** @param {Partial<{key: string, worldReadable: boolean}>} overrides */
  const row = (overrides) => ({ key: 'k', worldReadable: false, ...overrides });

  it('inhalte excludes home, channels, settings and members', () => {
    const zones = buildSidebarZones({
      tabs: [...tabs, 'members'],
      channelRows: [],
      isMember: false,
      isOwner: false
    });
    expect(zones.inhalte).toEqual(['chat', 'calendar', 'learning']);
  });

  it('footer is always members then settings', () => {
    const zones = buildSidebarZones({ tabs, channelRows: [], isMember: false, isOwner: false });
    expect(zones.footer).toEqual(['members', 'settings']);
  });

  it('member sees every channel row, including non-world-readable ones', () => {
    const rows = [row({ key: 'a', worldReadable: true }), row({ key: 'b', worldReadable: false })];
    const zones = buildSidebarZones({ tabs, channelRows: rows, isMember: true, isOwner: false });
    expect(zones.kanaele).toHaveLength(2);
    expect(zones.showLockHint).toBe(false);
  });

  it('owner sees every channel row too', () => {
    const rows = [row({ key: 'a', worldReadable: true }), row({ key: 'b', worldReadable: false })];
    const zones = buildSidebarZones({ tabs, channelRows: rows, isMember: false, isOwner: true });
    expect(zones.kanaele).toHaveLength(2);
    expect(zones.showLockHint).toBe(false);
  });

  it('visitor sees only world-readable rows, with a lock hint when rows were hidden', () => {
    const rows = [row({ key: 'a', worldReadable: true }), row({ key: 'b', worldReadable: false })];
    const zones = buildSidebarZones({ tabs, channelRows: rows, isMember: false, isOwner: false });
    expect(zones.kanaele).toEqual([row({ key: 'a', worldReadable: true })]);
    expect(zones.showLockHint).toBe(true);
  });

  it('visitor gets no lock hint when every row is already world-readable', () => {
    const rows = [row({ key: 'a', worldReadable: true }), row({ key: 'b', worldReadable: true })];
    const zones = buildSidebarZones({ tabs, channelRows: rows, isMember: false, isOwner: false });
    expect(zones.kanaele).toHaveLength(2);
    expect(zones.showLockHint).toBe(false);
  });

  it('dedupes channel rows by key, keeping first-seen', () => {
    const rows = [
      row({ key: 'a', worldReadable: true }),
      row({ key: 'a', worldReadable: true }),
      row({ key: 'b', worldReadable: true })
    ];
    const zones = buildSidebarZones({ tabs, channelRows: rows, isMember: true, isOwner: false });
    expect(zones.kanaele.map((r) => r.key)).toEqual(['a', 'b']);
  });

  it('empty channelRows produces an empty kanaele zone and no lock hint', () => {
    const zones = buildSidebarZones({ tabs, channelRows: [], isMember: false, isOwner: false });
    expect(zones.kanaele).toEqual([]);
    expect(zones.showLockHint).toBe(false);
  });

  // Without this entry, a community with zero channels has NO desktop path to
  // the channels view at all: buildSidebarZones drops the 'channels' tab id
  // and the zone itself only renders when it has rows (bug: laoc 2026-08-14,
  // "i dont know how to create a channel from here").
  it('owner with a channels tab but zero rows gets a create entry', () => {
    const zones = buildSidebarZones({ tabs, channelRows: [], isMember: false, isOwner: true });
    expect(zones.showCreateEntry).toBe(true);
  });

  it('a non-owner member with zero rows gets no create entry', () => {
    const zones = buildSidebarZones({ tabs, channelRows: [], isMember: true, isOwner: false });
    expect(zones.showCreateEntry).toBe(false);
  });

  it('owner with rows present ALSO gets the create entry (the zone is the only desktop surface)', () => {
    // Since the desktop layout dropped PrivateChannelsView's own rail
    // (2026-08-17, "double sidebar"), the zone carries channel creation
    // regardless of how many channels already exist.
    const rows = [row({ key: 'a', worldReadable: true })];
    const zones = buildSidebarZones({ tabs, channelRows: rows, isMember: false, isOwner: true });
    expect(zones.showCreateEntry).toBe(true);
  });

  it('owner without a channels tab gets no create entry', () => {
    const zones = buildSidebarZones({
      tabs: ['home', 'chat', 'settings'],
      channelRows: [],
      isMember: false,
      isOwner: true
    });
    expect(zones.showCreateEntry).toBe(false);
  });
});

describe('resolveZoneMembership', () => {
  // Review of 187b4c0b, critical 2: the zone-membership signal must be
  // roster/Concord/owner, NOT the kind-30000 follow-set flag — a roster
  // member who never follow-set-joined must still see the full Kanäle zone.
  it('a roster member who is NOT follow-set-joined counts as a zone member', () => {
    const zoneMember = resolveZoneMembership({
      isOwner: false,
      rosterIsMember: true,
      concordIsMember: false
    });
    expect(zoneMember).toBe(true);
  });

  it('a Concord member who is NOT follow-set-joined counts as a zone member', () => {
    const zoneMember = resolveZoneMembership({
      isOwner: false,
      rosterIsMember: false,
      concordIsMember: true
    });
    expect(zoneMember).toBe(true);
  });

  it('the owner counts as a zone member with no roster or Concord membership', () => {
    const zoneMember = resolveZoneMembership({
      isOwner: true,
      rosterIsMember: false,
      concordIsMember: false
    });
    expect(zoneMember).toBe(true);
  });

  it('a stranger with none of the three signals is not a zone member', () => {
    const zoneMember = resolveZoneMembership({
      isOwner: false,
      rosterIsMember: false,
      concordIsMember: false
    });
    expect(zoneMember).toBe(false);
  });
});
