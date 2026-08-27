/** @vitest-environment node */
// src/lib/__tests__/section-access.test.js
import { describe, it, expect } from 'vitest';
import { withSectionAccess } from '$lib/groups/section-access.js';
import { parseCommunityContentTypes } from '$lib/helpers/communityRelays.js';

const TAGS = [
  ['membership', 'root1', 'wss://g.example.com'],
  ['strict', 'content'],
  ['content', 'Learning'],
  ['k', '30142'],
  ['access', 'members'],
  ['content', 'Calendar'],
  ['k', '31922'],
  ['content', 'Forum'],
  ['k', '11']
];
const parse = (/** @type {string[][]} */ tags) => parseCommunityContentTypes({ kind: 10222, tags });

describe('withSectionAccess', () => {
  it('replaces an existing tier without touching sibling sections', () => {
    const out = withSectionAccess(TAGS, 'Learning', { tier: 'role', role: 'lehrkraft' });
    const [learning, calendar, forum] = parse(out);
    expect(learning.access).toEqual({ tier: 'role', role: 'lehrkraft' });
    expect(calendar.access).toEqual({ tier: 'all' });
    expect(forum.access).toEqual({ tier: 'all' });
    expect(out.filter((t) => t[0] === 'access')).toHaveLength(1);
    expect(TAGS.filter((t) => t[0] === 'access')).toHaveLength(1); // input untouched
  });

  it('adds a tier to a section that had none, inside that section only', () => {
    const out = withSectionAccess(TAGS, 'Calendar', { tier: 'members' });
    const [learning, calendar] = parse(out);
    expect(calendar.access).toEqual({ tier: 'members' });
    expect(learning.access).toEqual({ tier: 'members' }); // untouched original
    const contentIdx = out.findIndex((t) => t[0] === 'content' && t[1] === 'Calendar');
    expect(out[contentIdx + 1]).toEqual(['access', 'members']);
  });

  it('tier all removes the tag; last section works; unknown section is a no-op copy', () => {
    const cleared = withSectionAccess(TAGS, 'Learning', { tier: 'all' });
    expect(parse(cleared)[0].access).toEqual({ tier: 'all' });
    expect(cleared.some((t) => t[0] === 'access')).toBe(false);

    const last = withSectionAccess(TAGS, 'Forum', { tier: 'members' });
    expect(parse(last)[2].access).toEqual({ tier: 'members' });

    const noop = withSectionAccess(TAGS, 'NoSuch', { tier: 'members' });
    expect(noop).toEqual(TAGS);
    expect(noop).not.toBe(TAGS);
  });

  it('empty role means all; membership tag and strict marker are never disturbed', () => {
    const out = withSectionAccess(TAGS, 'Learning', { tier: 'role', role: '  ' });
    expect(out.some((t) => t[0] === 'access')).toBe(false);
    expect(out).toContainEqual(['membership', 'root1', 'wss://g.example.com']);
    expect(out).toContainEqual(['strict', 'content']);
  });
});
