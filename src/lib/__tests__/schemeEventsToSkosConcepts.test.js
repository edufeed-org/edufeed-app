/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { schemeEventsToSkosConcepts } from '$lib/helpers/educational/schemeEventsToSkosConcepts.js';

/**
 * Build a minimal kind-39737 ConceptScheme event.
 * @param {{ d: string, prefLabels?: Record<string,string>, pubkey?: string, id?: string }} opts
 */
function scheme({ d, prefLabels = { de: d }, pubkey = 'pub', id = `scheme-${d}` }) {
  /** @type {string[][]} */
  const tags = [
    ['d', d],
    ['type', 'ConceptScheme']
  ];
  for (const [lang, label] of Object.entries(prefLabels)) {
    tags.push(['prefLabel', label, lang]);
  }
  return { id, pubkey, kind: 39737, tags, content: '', sig: '', created_at: 0 };
}

/**
 * Build a kind-39737 Concept event — should be filtered out by the helper.
 * @param {{ d: string, label: string, pubkey?: string, id?: string }} opts
 */
function concept({ d, label, pubkey = 'pub', id = `concept-${d}` }) {
  return {
    id,
    pubkey,
    kind: 39737,
    tags: [
      ['d', d],
      ['type', 'Concept'],
      ['prefLabel', label, 'de']
    ],
    content: '',
    sig: '',
    created_at: 0
  };
}

describe('schemeEventsToSkosConcepts', () => {
  it('returns an empty array when given no events', () => {
    expect(schemeEventsToSkosConcepts([], 'de')).toEqual([]);
  });

  it('maps scheme events to flat SKOSConcept[] with level 0 and no parentId', () => {
    const events = [
      scheme({ d: 'schulfaecher', prefLabels: { de: 'Schulfächer', en: 'School subjects' } })
    ];
    const out = schemeEventsToSkosConcepts(events, 'de');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: '39737:pub:schulfaecher',
      labels: { de: 'Schulfächer', en: 'School subjects' },
      level: 0,
      notation: 'schulfaecher'
    });
    expect(out[0].parentId).toBeUndefined();
  });

  it('filters out Concept and Collection events, keeping only ConceptSchemes', () => {
    const events = [
      scheme({ d: 'hcrt', prefLabels: { de: 'HCRT' } }),
      concept({ d: 'some-concept', label: 'Leaf' }),
      {
        id: 'coll',
        pubkey: 'pub',
        kind: 39737,
        tags: [
          ['d', 'some-collection'],
          ['type', 'Collection'],
          ['prefLabel', 'Coll', 'de']
        ],
        content: '',
        sig: '',
        created_at: 0
      }
    ];
    const out = schemeEventsToSkosConcepts(events, 'de');
    expect(out.map((o) => o.id)).toEqual(['39737:pub:hcrt']);
  });

  it('sorts schemes alphabetically by locale-preferred label', () => {
    const events = [
      scheme({ d: 'zulu', prefLabels: { de: 'Zulu' } }),
      scheme({ d: 'anton', prefLabels: { de: 'Anton' } }),
      scheme({ d: 'mittel', prefLabels: { de: 'Mittel' } })
    ];
    const out = schemeEventsToSkosConcepts(events, 'de');
    expect(out.map((o) => o.notation)).toEqual(['anton', 'mittel', 'zulu']);
  });

  it('falls back locale → de → en → first when preferred label language is missing', () => {
    const events = [
      scheme({ d: 's-en', prefLabels: { en: 'English only' } }),
      scheme({ d: 's-other', prefLabels: { fr: 'Francais' } }),
      scheme({ d: 's-de', prefLabels: { de: 'Nur Deutsch' } })
    ];
    const out = schemeEventsToSkosConcepts(events, 'de');
    const byId = Object.fromEntries(out.map((o) => [o.notation, o]));
    expect(byId['s-en'].labels).toEqual({ en: 'English only' });
    expect(byId['s-other'].labels).toEqual({ fr: 'Francais' });
    expect(byId['s-de'].labels).toEqual({ de: 'Nur Deutsch' });
  });

  it('falls back to the d-tag as a label when no prefLabel tag exists', () => {
    const events = [
      {
        id: 'no-label',
        pubkey: 'pub',
        kind: 39737,
        tags: [
          ['d', 'orphan'],
          ['type', 'ConceptScheme']
        ],
        content: '',
        sig: '',
        created_at: 0
      }
    ];
    const out = schemeEventsToSkosConcepts(events, 'de');
    expect(out).toHaveLength(1);
    expect(out[0].labels).toEqual({ de: 'orphan' });
    expect(out[0].notation).toBe('orphan');
  });
});
