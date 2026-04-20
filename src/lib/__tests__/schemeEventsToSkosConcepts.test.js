/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  schemeEventsToSkosConcepts,
  pickSchemeDescription,
  pickSchemeLabel
} from '$lib/helpers/educational/schemeEventsToSkosConcepts.js';

/**
 * Build a minimal kind-39737 ConceptScheme event.
 * A `published_at` tag is included by default so the helper treats the event
 * as a published (non-draft) scheme. Pass `publishedAt: null` to omit it.
 * @param {{ d: string, prefLabels?: Record<string,string>, pubkey?: string, id?: string, publishedAt?: string | null }} opts
 */
function scheme({
  d,
  prefLabels = { de: d },
  pubkey = 'pub',
  id = `scheme-${d}`,
  publishedAt = '1710000000'
}) {
  /** @type {string[][]} */
  const tags = [
    ['d', d],
    ['type', 'ConceptScheme']
  ];
  for (const [lang, label] of Object.entries(prefLabels)) {
    tags.push(['prefLabel', label, lang]);
  }
  if (publishedAt !== null) tags.push(['published_at', publishedAt]);
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
          ['type', 'ConceptScheme'],
          ['published_at', '1710000000']
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

  it('filters out scheme events without a published_at tag (drafts)', () => {
    const events = [
      scheme({ d: 'published-one', prefLabels: { de: 'Published' } }),
      scheme({ d: 'draft-one', prefLabels: { de: 'Draft' }, publishedAt: null })
    ];
    const out = schemeEventsToSkosConcepts(events, 'de');
    expect(out.map((o) => o.notation)).toEqual(['published-one']);
  });

  it('treats an empty published_at tag value as unpublished', () => {
    const events = [scheme({ d: 'empty-ts', publishedAt: '' })];
    expect(schemeEventsToSkosConcepts(events, 'de')).toEqual([]);
  });

  it('keeps a scheme whose published_at is a non-empty timestamp string', () => {
    const events = [scheme({ d: 'real', publishedAt: '1710000000' })];
    const out = schemeEventsToSkosConcepts(events, 'de');
    expect(out).toHaveLength(1);
    expect(out[0].notation).toBe('real');
  });
});

describe('pickSchemeDescription', () => {
  /**
   * @param {{ descriptions?: Record<string,string> }} opts
   */
  function eventWith({ descriptions }) {
    /** @type {string[][]} */
    const tags = [
      ['d', 'x'],
      ['type', 'ConceptScheme']
    ];
    if (descriptions) {
      for (const [lang, value] of Object.entries(descriptions)) {
        tags.push(['description', value, lang]);
      }
    }
    return { id: 'ev', pubkey: 'pub', kind: 39737, tags, content: '', sig: '', created_at: 0 };
  }

  it("returns '' when the scheme carries no description tag", () => {
    expect(pickSchemeDescription(eventWith({}), 'de')).toBe('');
  });

  it('returns the locale-matched description when present', () => {
    const ev = eventWith({ descriptions: { de: 'Deutsche Beschreibung', en: 'English desc' } });
    expect(pickSchemeDescription(ev, 'de')).toBe('Deutsche Beschreibung');
    expect(pickSchemeDescription(ev, 'en')).toBe('English desc');
  });

  it('falls back locale → de → en → first when preferred language is missing', () => {
    const onlyEn = eventWith({ descriptions: { en: 'only english' } });
    expect(pickSchemeDescription(onlyEn, 'de')).toBe('only english');

    const deAndEn = eventWith({ descriptions: { de: 'deutsch', en: 'english' } });
    expect(pickSchemeDescription(deAndEn, 'fr')).toBe('deutsch');

    const onlyFr = eventWith({ descriptions: { fr: 'francais' } });
    expect(pickSchemeDescription(onlyFr, 'de')).toBe('francais');
  });

  it('ignores malformed description tags (missing value or lang)', () => {
    const ev = {
      id: 'ev',
      pubkey: 'pub',
      kind: 39737,
      tags: [
        ['d', 'x'],
        ['type', 'ConceptScheme'],
        ['description'], // no value, no lang
        ['description', '', 'de'], // empty value
        ['description', 'Gute Beschreibung', 'de'] // the good one
      ],
      content: '',
      sig: '',
      created_at: 0
    };
    expect(pickSchemeDescription(ev, 'de')).toBe('Gute Beschreibung');
  });
});

describe('pickSchemeLabel', () => {
  /**
   * @param {{ labels?: Record<string,string>, d?: string }} opts
   */
  function eventWith({ labels, d = 'x' }) {
    /** @type {string[][]} */
    const tags = [
      ['d', d],
      ['type', 'ConceptScheme']
    ];
    if (labels) {
      for (const [lang, value] of Object.entries(labels)) {
        tags.push(['prefLabel', value, lang]);
      }
    }
    return { id: 'ev', pubkey: 'pub', kind: 39737, tags, content: '', sig: '', created_at: 0 };
  }

  it('returns the locale-matched prefLabel when present', () => {
    const ev = eventWith({ labels: { de: 'Schulfächer', en: 'Subjects' } });
    expect(pickSchemeLabel(ev, 'de')).toBe('Schulfächer');
    expect(pickSchemeLabel(ev, 'en')).toBe('Subjects');
  });

  it('falls back locale → de → en → first when preferred language is missing', () => {
    const onlyEn = eventWith({ labels: { en: 'Subjects' } });
    expect(pickSchemeLabel(onlyEn, 'de')).toBe('Subjects');

    const deAndEn = eventWith({ labels: { de: 'Fächer', en: 'Subjects' } });
    expect(pickSchemeLabel(deAndEn, 'fr')).toBe('Fächer');

    const onlyFr = eventWith({ labels: { fr: 'Matières' } });
    expect(pickSchemeLabel(onlyFr, 'de')).toBe('Matières');
  });

  it('falls back to the d-tag when no prefLabel is present', () => {
    expect(pickSchemeLabel(eventWith({ d: 'hochschulfaecher' }), 'de')).toBe('hochschulfaecher');
  });

  it("returns '' when neither prefLabel nor d-tag is present", () => {
    const ev = {
      id: 'ev',
      pubkey: 'pub',
      kind: 39737,
      tags: [['type', 'ConceptScheme']],
      content: '',
      sig: '',
      created_at: 0
    };
    expect(pickSchemeLabel(ev, 'de')).toBe('');
  });
});
