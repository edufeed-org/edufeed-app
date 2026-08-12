/** @vitest-environment node */
// src/lib/__tests__/contentTypes-access-tiers.test.js
import { describe, it, expect } from 'vitest';
import {
  getRestrictedTabIds,
  getAccessibleTabIds,
  getVerifiedMembers
} from '$lib/helpers/contentTypes.js';

const OWNER = 'a'.repeat(64);
const MEMBER = 'b'.repeat(64);
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

/** Minimal ProfileListAccess stub */
const access = (canNames, membersByName = {}) => ({
  isLoading: false,
  canPublish: (name) => canNames.includes(name),
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
