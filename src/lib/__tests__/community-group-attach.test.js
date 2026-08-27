/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  buildGroupAttachTemplate,
  buildGroupDetachTemplate
} from '$lib/groups/community-attach.js';

const R = 'wss://groups.example';
const NOW = Math.floor(Date.now() / 1000);

const community = (/** @type {any} */ extra = {}) => ({
  kind: 10222,
  pubkey: 'a'.repeat(64),
  content: 'beschreibung',
  created_at: NOW - 500,
  tags: [
    ['d', 'relilab'],
    ['name', 'relilab']
  ],
  ...extra
});

describe('buildGroupAttachTemplate', () => {
  it('adds the channel pointer and keeps every other tag and the content', () => {
    const t = buildGroupAttachTemplate(community(), { id: 'allgemein', relay: R });
    expect(t.kind).toBe(10222);
    expect(t.content).toBe('beschreibung');
    expect(t.tags).toEqual([
      ['d', 'relilab'],
      ['name', 'relilab'],
      ['group', 'allgemein', R]
    ]);
  });

  it('carries the name and access marker when given', () => {
    const t = buildGroupAttachTemplate(community(), {
      id: 'leitung',
      relay: R,
      name: 'Leitung',
      access: 'invited'
    });
    expect(t.tags.at(-1)).toEqual(['group', 'leitung', R, 'Leitung', 'invited']);
  });

  it('keeps a concord pointer untouched — a community may carry both tags', () => {
    const withConcord = community({
      tags: [
        ['d', 'relilab'],
        ['concord', 'c'.repeat(64), 'wss://c.example']
      ]
    });
    const t = buildGroupAttachTemplate(withConcord, { id: 'allgemein', relay: R });
    expect(t.tags).toContainEqual(['concord', 'c'.repeat(64), 'wss://c.example']);
  });

  it('adds a second channel without dropping the first', () => {
    const one = buildGroupAttachTemplate(community(), { id: 'allgemein', relay: R });
    const two = buildGroupAttachTemplate(
      { ...community(), tags: one.tags },
      {
        id: 'leitung',
        relay: R
      }
    );
    expect(two.tags.filter((t) => t[0] === 'group')).toHaveLength(2);
  });

  // A replaceable event only wins if it is newer than the one it replaces.
  it('bumps created_at past the event it replaces', () => {
    const source = community({ created_at: NOW + 9000 });
    const t = buildGroupAttachTemplate(source, { id: 'allgemein', relay: R });
    expect(t.created_at).toBe(NOW + 9001);
  });

  it('uses now when the source event is older', () => {
    const t = buildGroupAttachTemplate(community(), { id: 'allgemein', relay: R });
    expect(t.created_at).toBeGreaterThanOrEqual(NOW);
  });

  it('refuses a pointer that is not addressable', () => {
    expect(() =>
      buildGroupAttachTemplate(community(), /** @type {any} */ ({ id: 'x', relay: 'not a url' }))
    ).toThrow();
  });
});

// laoc 2026-08-05: a community is extended by EXACTLY ONE protected area — a
// Concord area OR a set of NIP-29 groups. Mixing both is what the merge design
// deliberately rules out, so the offer has to close once one side is taken.
describe('buildGroupDetachTemplate', () => {
  it('removes exactly that channel and keeps its siblings', () => {
    const tags = [
      ['d', 'relilab'],
      ['group', 'allgemein', R],
      ['group', 'leitung', R]
    ];
    const t = buildGroupDetachTemplate(community({ tags }), { id: 'leitung', relay: R });
    expect(t.tags).toEqual([
      ['d', 'relilab'],
      ['group', 'allgemein', R]
    ]);
  });

  it('bumps created_at past the event it replaces', () => {
    const source = community({ created_at: NOW + 9000, tags: [['group', 'allgemein', R]] });
    const t = buildGroupDetachTemplate(source, { id: 'allgemein', relay: R });
    expect(t.created_at).toBe(NOW + 9001);
  });
});
