/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { conceptEventsToSkosTree } from '$lib/helpers/educational/conceptEventsToSkosTree.js';
import { CONCEPT_KIND } from 'nostr-vocab-core/constants';
import { createReplaceableAddress } from 'applesauce-core/helpers';

const conceptCoord = (/** @type {string} */ pubkey, /** @type {string} */ d) =>
  createReplaceableAddress(CONCEPT_KIND, pubkey, d);

/**
 * Build a minimal Concept event (NIP-VOCAB kind 39738).
 * @param {{ d: string, label: string, broader?: { coord: string, relay?: string }[], pubkey?: string, id?: string }} opts
 */
function concept({ d, label, broader = [], pubkey = 'pub', id = d }) {
  /** @type {string[][]} */
  const tags = [
    ['d', d],
    ['type', 'Concept'],
    ['prefLabel', label, 'de']
  ];
  for (const b of broader) {
    tags.push(['a', b.coord, b.relay ?? 'wss://r.example', 'broader']);
  }
  return { id, pubkey, kind: CONCEPT_KIND, tags, content: '', sig: '', created_at: 0 };
}

/** @param {any} e */
const getId = (e) => {
  const d = e.tags.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || '';
  return `nostr:${conceptCoord(e.pubkey, d)}`;
};

/** @param {any} e */
const getLabels = (e) => {
  /** @type {Record<string,string>} */
  const out = {};
  for (const t of e.tags) {
    if (t[0] === 'prefLabel' && t[1] && t[2]) out[t[2]] = t[1];
  }
  return out;
};

describe('conceptEventsToSkosTree', () => {
  it('returns a flat list (level 0, no parentId) when no broader tags exist', () => {
    const events = [
      concept({ d: 's1002', label: 'Biologie' }),
      concept({ d: 's1017', label: 'Mathematik' })
    ];
    const out = conceptEventsToSkosTree(events, getId, getLabels, 'de');
    expect(out).toHaveLength(2);
    for (const c of out) {
      expect(c.level).toBe(0);
      expect(c.parentId).toBeUndefined();
    }
    // Alphabetical by label within the same level
    expect(out.map((c) => c.labels.de)).toEqual(['Biologie', 'Mathematik']);
  });

  it('builds a hierarchy from broader tags (3 levels deep, DFS order)', () => {
    const events = [
      // shuffled arrival order to prove we rebuild order from hierarchy
      concept({
        d: 'subfield',
        label: 'Algebra',
        broader: [{ coord: conceptCoord('pub', 'dept1') }]
      }),
      concept({ d: 'faculty-a', label: 'Faculty A' }),
      concept({
        d: 'dept1',
        label: 'Dept 1',
        broader: [{ coord: conceptCoord('pub', 'faculty-a') }]
      }),
      concept({
        d: 'dept2',
        label: 'Dept 2',
        broader: [{ coord: conceptCoord('pub', 'faculty-a') }]
      })
    ];
    const out = conceptEventsToSkosTree(events, getId, getLabels, 'de');
    const byLabel = out.map((c) => ({ label: c.labels.de, level: c.level, parentId: c.parentId }));

    expect(byLabel).toEqual([
      { label: 'Faculty A', level: 0, parentId: undefined },
      { label: 'Dept 1', level: 1, parentId: `nostr:${conceptCoord('pub', 'faculty-a')}` },
      { label: 'Algebra', level: 2, parentId: `nostr:${conceptCoord('pub', 'dept1')}` },
      { label: 'Dept 2', level: 1, parentId: `nostr:${conceptCoord('pub', 'faculty-a')}` }
    ]);
  });

  it('treats a concept whose broader target is missing as a root', () => {
    const events = [
      concept({
        d: 'orphan',
        label: 'Orphan',
        broader: [{ coord: conceptCoord('pub', 'never-loaded') }]
      }),
      concept({ d: 'root', label: 'Root' })
    ];
    const out = conceptEventsToSkosTree(events, getId, getLabels, 'de');
    expect(out).toHaveLength(2);
    for (const c of out) {
      expect(c.level).toBe(0);
      expect(c.parentId).toBeUndefined();
    }
  });

  it('does not hang when broader chain contains a cycle', () => {
    const events = [
      concept({
        d: 'a',
        label: 'A',
        broader: [{ coord: conceptCoord('pub', 'b') }]
      }),
      concept({
        d: 'b',
        label: 'B',
        broader: [{ coord: conceptCoord('pub', 'a') }]
      })
    ];
    // If cycle-breaking is broken this will throw (recursion limit) or timeout.
    const out = conceptEventsToSkosTree(events, getId, getLabels, 'de');
    expect(out).toHaveLength(2);
    // Both concepts must still be emitted, even if their levels end up synthetic.
    const labels = out.map((c) => c.labels.de).sort();
    expect(labels).toEqual(['A', 'B']);
  });

  it('carries notation through when present', () => {
    const events = [
      {
        id: 'x',
        pubkey: 'pub',
        kind: CONCEPT_KIND,
        content: '',
        sig: '',
        created_at: 0,
        tags: [
          ['d', 's1017'],
          ['type', 'Concept'],
          ['prefLabel', 'Mathematik', 'de'],
          ['notation', 's1017']
        ]
      }
    ];
    const out = conceptEventsToSkosTree(events, getId, getLabels, 'de');
    expect(out[0].notation).toBe('s1017');
  });

  it('drops concept events that have no d tag (cannot be addressed)', () => {
    const events = [
      {
        id: 'no-d',
        pubkey: 'pub',
        kind: CONCEPT_KIND,
        content: '',
        sig: '',
        created_at: 0,
        tags: [
          ['type', 'Concept'],
          ['prefLabel', 'Ghost', 'de']
        ]
      },
      concept({ d: 'real', label: 'Real' })
    ];
    const out = conceptEventsToSkosTree(events, getId, getLabels, 'de');
    expect(out.map((c) => c.labels.de)).toEqual(['Real']);
  });
});
