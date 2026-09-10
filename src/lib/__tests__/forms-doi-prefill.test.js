/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { applyDoiPrefill } from '$lib/helpers/forms/doi-prefill.js';

// The EKKW form's field set, as parseFormTemplate yields it: `output` names the
// AMB property (or 'ext'), `type` the renderer, ids are the template author's.
const fields = [
  { id: 'doi', type: 'doi', label: 'DOI', output: 'amb:id', options: {} },
  { id: 'titel', type: 'text', label: 'Titel', output: 'amb:name', options: {} },
  {
    id: 'beschreibung',
    type: 'textarea',
    label: 'Beschreibung',
    output: 'amb:description',
    options: {}
  },
  {
    id: 'erschienen-in',
    type: 'amb-relation',
    label: 'Erschienen in',
    output: 'amb:isPartOf',
    options: {}
  },
  { id: 'band', type: 'text', label: 'Band', output: 'ext', options: {} },
  { id: 'heft', type: 'text', label: 'Heft', output: 'ext', options: {} },
  { id: 'datum', type: 'date', label: 'Datum', output: 'amb:datePublished', options: {} },
  {
    id: 'schlagworte',
    type: 'text-array',
    label: 'Schlagworte',
    output: 'amb:keywords',
    options: {}
  },
  {
    id: 'sprache',
    type: 'select',
    label: 'Sprache',
    output: 'amb:inLanguage',
    options: {
      options: [
        { id: 'de', label: 'Deutsch' },
        { id: 'en', label: 'Englisch' }
      ]
    }
  },
  { id: 'autoren', type: 'creator', label: 'Autoren', output: 'amb:creator', options: {} },
  {
    id: 'herausgeber',
    type: 'creator',
    label: 'Herausgeber',
    output: 'amb:contributor',
    options: {}
  }
];

/** @type {import('$lib/helpers/publication/crossref.js').DoiPrefill} */
const prefill = {
  title: 'Ein Beitrag',
  abstract: 'Worum es geht.',
  journal: 'Zeitschrift für Theologie',
  volume: '12',
  issue: '3',
  datePublished: '2024-05-01',
  keywords: ['Theologie', 'Didaktik'],
  inLanguage: 'de',
  creators: [
    { name: 'Anna Beispiel', type: 'Person', orcid: 'https://orcid.org/0000-0002-1825-0097' }
  ]
};

/** Empty values as FormRenderer seeds them (text-array starts as ['']). */
function emptyValues() {
  return {
    doi: 'https://doi.org/10.1000/x',
    titel: '',
    beschreibung: '',
    'erschienen-in': [],
    band: '',
    heft: '',
    datum: '',
    schlagworte: [''],
    sprache: '',
    autoren: [],
    herausgeber: []
  };
}

describe('applyDoiPrefill', () => {
  it('maps every Crossref property onto the sibling field with the matching output', () => {
    const { values, filled } = applyDoiPrefill(fields, emptyValues(), prefill);
    expect(values.titel).toBe('Ein Beitrag');
    expect(values.beschreibung).toBe('Worum es geht.');
    expect(values['erschienen-in']).toEqual([{ name: 'Zeitschrift für Theologie' }]);
    expect(values.band).toBe('12');
    expect(values.heft).toBe('3');
    expect(values.datum).toBe('2024-05-01');
    expect(values.schlagworte).toEqual(['Theologie', 'Didaktik']);
    expect(values.sprache).toBe('de');
    expect(values.autoren).toEqual([
      { name: 'Anna Beispiel', type: 'Person', orcid: 'https://orcid.org/0000-0002-1825-0097' }
    ]);
    expect(filled.sort()).toEqual(
      [
        'autoren',
        'band',
        'beschreibung',
        'datum',
        'erschienen-in',
        'heft',
        'schlagworte',
        'sprache',
        'titel'
      ].sort()
    );
  });

  it('never overwrites a value the respondent already entered', () => {
    const values = {
      ...emptyValues(),
      titel: 'Mein Titel',
      schlagworte: ['eigenes'],
      autoren: [{ name: 'Ich', type: 'Person' }],
      'erschienen-in': [{ name: 'Mein Journal' }]
    };
    const result = applyDoiPrefill(fields, values, prefill);
    expect(result.values.titel).toBe('Mein Titel');
    expect(result.values.schlagworte).toEqual(['eigenes']);
    expect(result.values.autoren).toEqual([{ name: 'Ich', type: 'Person' }]);
    expect(result.values['erschienen-in']).toEqual([{ name: 'Mein Journal' }]);
    expect(result.filled).not.toContain('titel');
    expect(result.filled).toContain('band');
  });

  it('leaves the contributor field alone: Crossref authors are creators, not editors', () => {
    const { values } = applyDoiPrefill(fields, emptyValues(), prefill);
    expect(values.herausgeber).toEqual([]);
  });

  it('accepts volume/issue as ext field ids too', () => {
    const extFields = [
      { id: 'volume', type: 'text', output: 'ext', options: {} },
      { id: 'issue', type: 'text', output: 'ext', options: {} }
    ];
    const { values } = applyDoiPrefill(extFields, { volume: '', issue: '' }, prefill);
    expect(values).toEqual({ volume: '12', issue: '3' });
  });

  it('only sets a select when the fetched value is one of its options', () => {
    const { values, filled } = applyDoiPrefill(fields, emptyValues(), {
      ...prefill,
      inLanguage: 'fr'
    });
    expect(values.sprache).toBe('');
    expect(filled).not.toContain('sprache');
  });

  it('returns the input untouched when the prefill is empty', () => {
    const before = emptyValues();
    const { values, filled } = applyDoiPrefill(fields, before, {});
    expect(values).toEqual(before);
    expect(filled).toEqual([]);
  });

  it('does not mutate the values object it was given', () => {
    const before = emptyValues();
    applyDoiPrefill(fields, before, prefill);
    expect(before.titel).toBe('');
  });
});
