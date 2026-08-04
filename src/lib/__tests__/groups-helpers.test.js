/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  parseGroupInput,
  buildGroupMessageTemplate,
  buildJoinRequestTemplate,
  buildLeaveRequestTemplate,
  buildGroupsListTemplate,
  groupHref
} from '$lib/groups/groups.js';

const ME = 'c'.repeat(64);

describe('parseGroupInput', () => {
  it("parses host'id into a normalized pointer", () => {
    expect(parseGroupInput("groups.example.com'beechat")).toEqual({
      relay: 'wss://groups.example.com/',
      id: 'beechat'
    });
  });

  it('accepts an explicit wss:// prefix and trims whitespace', () => {
    expect(parseGroupInput("  wss://groups.example.com'beechat ")).toEqual({
      relay: 'wss://groups.example.com/',
      id: 'beechat'
    });
  });

  it("defaults a missing id to '_' (NIP-29 root group) and rejects empty input", () => {
    expect(parseGroupInput('groups.example.com')).toEqual({
      relay: 'wss://groups.example.com/',
      id: '_'
    });
    expect(parseGroupInput('')).toBeNull();
    expect(parseGroupInput('   ')).toBeNull();
  });
});

describe('groupHref', () => {
  it('round-trips a pointer through the URL param', () => {
    const pointer = { relay: 'wss://groups.example.com/', id: 'beechat' };
    const href = groupHref(pointer);
    expect(href.startsWith('/groups/')).toBe(true);
    const param = decodeURIComponent(href.slice('/groups/'.length));
    expect(parseGroupInput(param)).toEqual(pointer);
  });
});

describe('buildGroupMessageTemplate', () => {
  it('builds a kind-9 with the h tag first, like the app community chat', () => {
    const template = buildGroupMessageTemplate('beechat', 'hello group');
    expect(template.kind).toBe(9);
    expect(template.content).toBe('hello group');
    expect(template.tags[0]).toEqual(['h', 'beechat']);
    expect(typeof template.created_at).toBe('number');
  });

  it('adds NIP-10 reply marker + p tag when replying', () => {
    const template = buildGroupMessageTemplate('beechat', 'reply text', {
      id: 'parent-1',
      pubkey: 'a'.repeat(64)
    });
    expect(template.tags).toContainEqual(['e', 'parent-1', '', 'reply']);
    expect(template.tags).toContainEqual(['p', 'a'.repeat(64)]);
  });
});

describe('join/leave request templates', () => {
  it('kind 9021 join with h tag; invite code rides as a code tag when given', () => {
    expect(buildJoinRequestTemplate('beechat').tags).toEqual([['h', 'beechat']]);
    expect(buildJoinRequestTemplate('beechat', 'sekrit').tags).toEqual([
      ['h', 'beechat'],
      ['code', 'sekrit']
    ]);
    expect(buildJoinRequestTemplate('beechat').kind).toBe(9021);
  });

  it('kind 9022 leave with h tag', () => {
    const template = buildLeaveRequestTemplate('beechat');
    expect(template.kind).toBe(9022);
    expect(template.tags).toEqual([['h', 'beechat']]);
  });
});

describe('buildGroupsListTemplate', () => {
  const pointer = { relay: 'wss://groups.example.com/', id: 'beechat' };

  it('adds a group tag to an empty list (kind 10009)', () => {
    const template = buildGroupsListTemplate(null, { add: pointer });
    expect(template.kind).toBe(10009);
    expect(template.tags).toEqual([['group', 'beechat', 'wss://groups.example.com/']]);
  });

  it('preserves existing group tags, dedupes on re-add, and removes on remove', () => {
    const existing = {
      kind: 10009,
      pubkey: ME,
      content: '',
      created_at: 1,
      tags: [
        ['group', 'other', 'wss://other.example/'],
        ['group', 'beechat', 'wss://groups.example.com/']
      ]
    };
    const readd = buildGroupsListTemplate(existing, { add: pointer });
    expect(readd.tags.filter((t) => t[1] === 'beechat')).toHaveLength(1);
    expect(readd.tags).toHaveLength(2);

    const removed = buildGroupsListTemplate(existing, { remove: pointer });
    expect(removed.tags).toEqual([['group', 'other', 'wss://other.example/']]);
  });

  it('preserves non-group tags (e.g. hidden-list content stays untouched)', () => {
    const existing = {
      kind: 10009,
      pubkey: ME,
      content: 'encrypted-hidden-groups',
      created_at: 1,
      tags: [['client', 'edufeed']]
    };
    const template = buildGroupsListTemplate(existing, { add: pointer });
    expect(template.content).toBe('encrypted-hidden-groups');
    expect(template.tags).toContainEqual(['client', 'edufeed']);
  });
});
