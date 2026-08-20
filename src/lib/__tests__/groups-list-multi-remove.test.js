/** @vitest-environment node */
// buildGroupsListTemplate must remove MANY group entries in one rewrite so a
// community teardown prunes root + every channel from the user's kind-10009 in
// a single replaceable publish (not N racy ones). Single-pointer remove stays
// working; the host `r` server tags are never touched by a removal.
import { describe, it, expect } from 'vitest';
import { buildGroupsListTemplate } from '$lib/groups/groups.js';

const existing = {
  kind: 10009,
  content: '',
  tags: [
    ['group', 'id1', 'wss://a.example/'],
    ['group', 'id2', 'wss://b.example/'],
    ['group', 'id3', 'wss://a.example/'],
    ['r', 'wss://a.example/'],
    ['r', 'wss://b.example/']
  ]
};

/** @param {any} tpl @returns {string[][]} */
const groupTags = (tpl) => tpl.tags.filter((/** @type {string[]} */ t) => t[0] === 'group');
/** @param {any} tpl @returns {string[][]} */
const rTags = (tpl) => tpl.tags.filter((/** @type {string[]} */ t) => t[0] === 'r');
/** @param {string[][]} tags @returns {string[]} */
const idsOf = (tags) => tags.map((t) => t[1]);

describe('buildGroupsListTemplate — multi remove', () => {
  it('removes every listed pointer in one rewrite', () => {
    const tpl = buildGroupsListTemplate(existing, {
      remove: [
        { id: 'id1', relay: 'wss://a.example' },
        { id: 'id2', relay: 'wss://b.example' }
      ]
    });
    expect(idsOf(groupTags(tpl))).toEqual(['id3']); // only the un-removed one survives
    // server `r` tags are untouched by removals.
    expect(idsOf(rTags(tpl))).toEqual(['wss://a.example/', 'wss://b.example/']);
  });

  it('still accepts a single pointer (back-compat)', () => {
    const tpl = buildGroupsListTemplate(existing, {
      remove: { id: 'id1', relay: 'wss://a.example' }
    });
    expect(idsOf(groupTags(tpl)).sort()).toEqual(['id2', 'id3']);
  });

  it('normalises relay spelling when matching removals', () => {
    // caller passes "wss://A.example" (no slash, mixed case) — must still match.
    const tpl = buildGroupsListTemplate(existing, {
      remove: [{ id: 'id1', relay: 'wss://A.example' }]
    });
    expect(idsOf(groupTags(tpl))).toEqual(['id2', 'id3']);
  });
});
