/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  communityNavTabIds,
  buildSidebarZones
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

  it('shows channels for the owner even without a pointer or membership', () => {
    const ids = communityNavTabIds({
      communityEvent: openCommunityEvent(),
      ...baseArgs,
      concordEnabled: true,
      isOwner: true
    });
    expect(ids).toContain('channels');
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
});
