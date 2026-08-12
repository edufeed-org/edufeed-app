/** @vitest-environment node */
// src/lib/__tests__/community-flips.test.js
import { describe, it, expect } from 'vitest';
import {
  stripLegacySectionAcl,
  buildFlipToModeratedTags,
  buildFlipToOpenTags,
  communityUpdateTemplate
} from '$lib/groups/community-flips.js';
import { deriveCommunityType, parseMembershipPointer } from '$lib/groups/community-membership.js';
import { parseCommunityContentTypes } from '$lib/helpers/communityRelays.js';

const PK = 'a'.repeat(64);
const RELAY = 'wss://g.example.com';
const OPEN_TAGS = [
  ['r', 'wss://relay.example.com'],
  ['strict', 'content'],
  ['content', 'Learning'],
  ['k', '30142'],
  ['a', `30000:${PK}:Learning`],
  ['a', `30168:${PK}:membership`, '', 'form'],
  ['content', 'Forum'],
  ['k', '11']
];
const MODERATED_TAGS = [
  ['r', 'wss://relay.example.com'],
  ['membership', 'root1', RELAY],
  ['application', `30168:${PK}:beitritt`, RELAY],
  ['strict', 'content'],
  ['content', 'Learning'],
  ['k', '30142'],
  ['access', 'role', 'lehrkraft'],
  ['group', 'chan1', RELAY, 'Kanal', 'members']
];

describe('stripLegacySectionAcl', () => {
  it('removes 30000 and form-marked 30168 a-tags, keeps everything else', () => {
    const out = stripLegacySectionAcl(OPEN_TAGS);
    expect(out.some((t) => t[0] === 'a')).toBe(false);
    expect(out).toContainEqual(['content', 'Learning']);
    expect(out).toContainEqual(['strict', 'content']);
    expect(OPEN_TAGS.filter((t) => t[0] === 'a')).toHaveLength(2); // input untouched
  });
  it('keeps non-form 30168 a-tags and badge a-tags out of scope', () => {
    const tags = [
      ['content', 'X'],
      ['a', `30168:${PK}:x`],
      ['a', `30009:${PK}:writer`, 'write']
    ];
    const out = stripLegacySectionAcl(tags);
    expect(out).toContainEqual(['a', `30168:${PK}:x`]);
    expect(out).toContainEqual(['a', `30009:${PK}:writer`, 'write']);
  });
});

describe('buildFlipToModeratedTags', () => {
  const flipped = buildFlipToModeratedTags(OPEN_TAGS, { id: 'root1', relay: RELAY });
  it('derives moderated, membership sits before the first content/strict tag', () => {
    expect(deriveCommunityType({ tags: flipped })).toBe('moderated');
    const membershipIdx = flipped.findIndex((t) => t[0] === 'membership');
    const strictIdx = flipped.findIndex((t) => t[0] === 'strict');
    const contentIdx = flipped.findIndex((t) => t[0] === 'content');
    expect(membershipIdx).toBeGreaterThan(-1);
    expect(membershipIdx).toBeLessThan(strictIdx);
    expect(membershipIdx).toBeLessThan(contentIdx);
  });
  it('strips legacy ACL, keeps sections ungated (never retroactively gates)', () => {
    expect(flipped.some((t) => t[0] === 'a')).toBe(false);
    const sections = parseCommunityContentTypes({ kind: 10222, tags: flipped });
    expect(sections.every((s) => s.access.tier === 'all')).toBe(true);
  });
  it('replaces a pre-existing membership tag instead of doubling', () => {
    const again = buildFlipToModeratedTags(flipped, { id: 'root2', relay: RELAY });
    expect(again.filter((t) => t[0] === 'membership')).toHaveLength(1);
    expect(parseMembershipPointer({ tags: again })).toEqual({ id: 'root2', relay: RELAY });
  });
});

describe('buildFlipToOpenTags', () => {
  const opened = buildFlipToOpenTags(MODERATED_TAGS);
  it('derives open; membership/application/access/group all gone; sections kept', () => {
    expect(deriveCommunityType({ tags: opened })).toBe('open');
    for (const key of ['membership', 'application', 'access', 'group']) {
      expect(opened.some((t) => t[0] === key)).toBe(false);
    }
    expect(opened).toContainEqual(['content', 'Learning']);
    expect(opened).toContainEqual(['k', '30142']);
  });
});

describe('communityUpdateTemplate', () => {
  it('bumps created_at past the source event', () => {
    const future = Math.floor(Date.now() / 1000) + 999;
    const template = communityUpdateTemplate(
      { kind: 10222, content: 'desc', created_at: future, tags: MODERATED_TAGS },
      buildFlipToOpenTags(MODERATED_TAGS)
    );
    expect(template.kind).toBe(10222);
    expect(template.content).toBe('desc');
    expect(template.created_at).toBe(future + 1);
  });
});
