/** @vitest-environment node */
// src/lib/__tests__/contentTypes-access-tiers.test.js
import { describe, it, expect } from 'vitest';
import {
  getRestrictedTabIds,
  getAccessibleTabIds,
  getVerifiedMembers,
  getCommunityTabs
} from '$lib/helpers/contentTypes.js';

const OWNER = 'a'.repeat(64);
const MEMBER = 'b'.repeat(64);
const RELAY = 'wss://groups.example.com';
const moderatedEvent = {
  kind: 10222,
  pubkey: OWNER,
  tags: [
    ['membership', 'root1', 'wss://groups.example.com'],
    ['strict', 'content'],
    ['content', 'Learning'],
    ['k', '30142'],
    ['access', 'role', 'lehrkraft'],
    ['content', 'Calendar'],
    ['k', '31922'],
    ['k', '31923'],
    ['access', 'members'],
    ['content', 'Forum'],
    ['k', '11']
  ]
};

/**
 * Minimal ProfileListAccess stub
 * @param {string[]} canNames
 * @param {Record<string, string[]>} membersByName
 */
const access = (canNames, membersByName = {}) => ({
  isLoading: false,
  /** @param {string} name */
  canPublish: (name) => canNames.includes(name),
  /** @param {string} name */
  getMembers: (name) => membersByName[name] ?? [],
  getAllowedAuthors: () => null,
  getFormRef: () => null
});

describe('access tiers gate tabs and members', () => {
  it('getRestrictedTabIds includes access-tiered sections', () => {
    const restricted = getRestrictedTabIds(moderatedEvent);
    expect(restricted.has('learning')).toBe(true);
    expect(restricted.has('calendar')).toBe(true);
    expect(restricted.has('forum')).toBe(false);
  });

  it('getAccessibleTabIds respects canPublish on tiered sections', () => {
    const accessible = getAccessibleTabIds(moderatedEvent, access(['Calendar']));
    expect(accessible.has('calendar')).toBe(true);
    expect(accessible.has('learning')).toBe(false);
  });

  it('getVerifiedMembers aggregates members of tiered sections (owner always included)', () => {
    const { allMembers, perSection } = getVerifiedMembers(
      access([], { Calendar: [MEMBER] }),
      moderatedEvent
    );
    expect(allMembers).toContain(OWNER);
    expect(allMembers).toContain(MEMBER);
    expect(perSection.get('Calendar')).toEqual([MEMBER]);
  });
});

describe('getCommunityTabs', () => {
  const closedEvent = {
    kind: 10222,
    pubkey: OWNER,
    tags: [['concord', 'c'.repeat(64), RELAY]]
  };
  const openEvent = { kind: 10222, pubkey: OWNER, tags: [] };
  // Legacy definition: declares content sections but lacks the
  // ["strict", "content"] marker — advisory only, fails open per the
  // fail-open rule (pre-existing behavior, unaffected by the closed check).
  const legacyEvent = {
    kind: 10222,
    pubkey: OWNER,
    tags: [
      ['content', 'Forum'],
      ['k', '11']
    ]
  };

  it('returns only home+settings for a closed community (concord pointer, no membership pointer)', () => {
    expect(getCommunityTabs(closedEvent)).toEqual(['home', 'settings']);
  });

  it('returns the full default tab set for an open community (no pointers)', () => {
    const tabs = getCommunityTabs(openEvent);
    expect(tabs).toContain('chat');
    expect(tabs).toContain('learning');
    expect(tabs[0]).toBe('home');
    expect(tabs[tabs.length - 1]).toBe('settings');
  });

  it('returns the full default tab set for null/undefined (fail open)', () => {
    const tabs = getCommunityTabs(null);
    expect(tabs).toContain('chat');
    expect(tabs[0]).toBe('home');
  });

  it('filters to declared sections for a moderated community with the strict marker', () => {
    expect(getCommunityTabs(moderatedEvent)).toEqual([
      'home',
      'forum',
      'learning',
      'calendar',
      'settings'
    ]);
  });

  it('fails open for a legacy definition without the strict marker', () => {
    const tabs = getCommunityTabs(legacyEvent);
    expect(tabs).toContain('chat');
    expect(tabs).toContain('boards');
    expect(tabs[0]).toBe('home');
  });
});
