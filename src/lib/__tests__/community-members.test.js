/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { getVerifiedMembers } from '$lib/helpers/contentTypes.js';

/**
 * Helper: build a minimal kind 10222 event with content sections
 * @param {string} ownerPubkey
 * @param {Array<{name: string, kinds: number[], profileList?: string}>} sections
 */
function makeCommunityEvent(ownerPubkey, sections = []) {
  const tags = [];
  for (const section of sections) {
    tags.push(['content', section.name]);
    for (const kind of section.kinds) {
      tags.push(['k', String(kind)]);
    }
    if (section.profileList) {
      tags.push(['a', section.profileList]);
    }
  }
  return { kind: 10222, pubkey: ownerPubkey, tags };
}

/**
 * Helper: build a mock profileAccess object
 * @param {Map<string, string[]>} membersBySection
 */
function makeProfileAccess(membersBySection) {
  return {
    isLoading: false,
    canPublish: (/** @type {string} */ _name) => true,
    getMembers: (/** @type {string} */ _name) => membersBySection.get(_name) || [],
    getAllowedAuthors: (/** @type {string} */ _name) =>
      membersBySection.has(_name) ? membersBySection.get(_name) : null,
    getFormRef: (/** @type {string} */ _name) => null
  };
}

describe('getVerifiedMembers', () => {
  const owner = 'aaaa'.repeat(16);
  const alice = 'bbbb'.repeat(16);
  const bob = 'cccc'.repeat(16);
  const carol = 'dddd'.repeat(16);

  it('returns owner when community has no gated sections', () => {
    const event = makeCommunityEvent(owner, [
      { name: 'Chat', kinds: [9] },
      { name: 'Calendar', kinds: [31923] }
    ]);
    const profileAccess = makeProfileAccess(new Map());

    const result = getVerifiedMembers(profileAccess, event);

    expect(result.allMembers).toEqual([owner]);
    expect(result.perSection.size).toBe(0);
  });

  it('unions members from multiple gated sections', () => {
    const event = makeCommunityEvent(owner, [
      { name: 'Learning', kinds: [30142], profileList: '30000:xyz:learning-list' },
      { name: 'Calendar', kinds: [31923], profileList: '30000:xyz:calendar-list' }
    ]);
    const profileAccess = makeProfileAccess(
      new Map([
        ['Learning', [alice, bob]],
        ['Calendar', [bob, carol]]
      ])
    );

    const result = getVerifiedMembers(profileAccess, event);

    expect(result.allMembers).toContain(owner);
    expect(result.allMembers).toContain(alice);
    expect(result.allMembers).toContain(bob);
    expect(result.allMembers).toContain(carol);
    expect(result.allMembers.length).toBe(4);
  });

  it('deduplicates members across sections', () => {
    const event = makeCommunityEvent(owner, [
      { name: 'Learning', kinds: [30142], profileList: '30000:xyz:learning-list' },
      { name: 'Calendar', kinds: [31923], profileList: '30000:xyz:calendar-list' }
    ]);
    const profileAccess = makeProfileAccess(
      new Map([
        ['Learning', [alice, bob]],
        ['Calendar', [alice, bob]]
      ])
    );

    const result = getVerifiedMembers(profileAccess, event);

    // alice + bob + owner = 3 unique
    expect(result.allMembers.length).toBe(3);
  });

  it('always includes owner even when owner is in a profile list', () => {
    const event = makeCommunityEvent(owner, [
      { name: 'Learning', kinds: [30142], profileList: '30000:xyz:learning-list' }
    ]);
    const profileAccess = makeProfileAccess(new Map([['Learning', [owner, alice]]]));

    const result = getVerifiedMembers(profileAccess, event);

    expect(result.allMembers.length).toBe(2); // owner + alice, no duplicate
    expect(result.allMembers).toContain(owner);
    expect(result.allMembers).toContain(alice);
  });

  it('provides per-section member breakdown', () => {
    const event = makeCommunityEvent(owner, [
      { name: 'Learning', kinds: [30142], profileList: '30000:xyz:learning-list' },
      { name: 'Calendar', kinds: [31923], profileList: '30000:xyz:calendar-list' }
    ]);
    const profileAccess = makeProfileAccess(
      new Map([
        ['Learning', [alice]],
        ['Calendar', [bob]]
      ])
    );

    const result = getVerifiedMembers(profileAccess, event);

    expect(result.perSection.get('Learning')).toEqual([alice]);
    expect(result.perSection.get('Calendar')).toEqual([bob]);
  });

  it('handles null communityEvent gracefully', () => {
    const profileAccess = makeProfileAccess(new Map());

    const result = getVerifiedMembers(profileAccess, null);

    expect(result.allMembers).toEqual([]);
    expect(result.perSection.size).toBe(0);
  });

  it('skips sections without profileList (open sections)', () => {
    const event = makeCommunityEvent(owner, [
      { name: 'Chat', kinds: [9] }, // open
      { name: 'Learning', kinds: [30142], profileList: '30000:xyz:learning-list' }
    ]);
    const profileAccess = makeProfileAccess(new Map([['Learning', [alice]]]));

    const result = getVerifiedMembers(profileAccess, event);

    expect(result.perSection.has('Chat')).toBe(false);
    expect(result.perSection.has('Learning')).toBe(true);
    expect(result.allMembers).toContain(owner);
    expect(result.allMembers).toContain(alice);
  });
});
