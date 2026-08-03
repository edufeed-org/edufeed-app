import { describe, it, expect, vi } from 'vitest';
import { crossrefWorkToPrefill, fetchDoiPrefill } from '$lib/helpers/publication/crossref.js';

/**
 * Trimmed but shape-faithful Crossref work message (the fields we map, in
 * the wire shapes Crossref actually uses: title as array, issued as
 * date-parts, JATS-tagged abstract, ORCID as URI).
 */
const WORK = {
  DOI: '10.1000/xyz123',
  title: ['Religionspädagogik im digitalen Raum'],
  author: [
    {
      given: 'Maria',
      family: 'Musterfrau',
      ORCID: 'http://orcid.org/0000-0002-1825-0097',
      affiliation: [{ name: 'Universität Kassel' }]
    },
    { given: 'Jan', family: 'Beispiel' },
    { name: 'Comenius-Institut' }
  ],
  issued: { 'date-parts': [[2024, 3, 5]] },
  'container-title': ['Zeitschrift für Pädagogik und Theologie'],
  volume: '76',
  issue: '2',
  publisher: 'De Gruyter',
  language: 'de',
  subject: ['Religious studies', 'Education'],
  abstract: '<jats:p>Ein <jats:italic>Beitrag</jats:italic> zur Hochschullehre.</jats:p>'
};

describe('crossrefWorkToPrefill', () => {
  it('maps the full work onto the prefill shape', () => {
    const p = crossrefWorkToPrefill(WORK);
    expect(p).toEqual({
      doi: '10.1000/xyz123',
      title: 'Religionspädagogik im digitalen Raum',
      creators: [
        {
          name: 'Maria Musterfrau',
          type: 'Person',
          orcid: 'https://orcid.org/0000-0002-1825-0097',
          affiliationName: 'Universität Kassel'
        },
        { name: 'Jan Beispiel', type: 'Person' },
        { name: 'Comenius-Institut', type: 'Organization' }
      ],
      datePublished: '2024-03-05',
      journal: 'Zeitschrift für Pädagogik und Theologie',
      volume: '76',
      issue: '2',
      publisher: 'De Gruyter',
      inLanguage: 'de',
      keywords: ['Religious studies', 'Education'],
      abstract: 'Ein Beitrag zur Hochschullehre.'
    });
  });

  it('emits a year-only date when Crossref has no month/day', () => {
    const p = crossrefWorkToPrefill({ issued: { 'date-parts': [[2019]] } });
    expect(p.datePublished).toBe('2019');
  });

  it('returns only the fields that are present — an empty work maps to {}', () => {
    expect(crossrefWorkToPrefill({})).toEqual({});
    expect(crossrefWorkToPrefill(null)).toEqual({});
    expect(crossrefWorkToPrefill('nonsense')).toEqual({});
  });

  it('drops authors without any name and non-ISO language values', () => {
    const p = crossrefWorkToPrefill({
      author: [{ ORCID: 'https://orcid.org/0000-0000-0000-0001' }],
      language: 'unknown-weird'
    });
    expect(p.creators).toBeUndefined();
    // 'unknown-weird'.slice(0,2) is 'un' — structurally valid ISO shape; the
    // guard is about SHAPE, not registry membership.
    expect(p.inLanguage).toBe('un');
  });
});

describe('fetchDoiPrefill', () => {
  /** @param {any} message */
  const okResponse = (message) => ({
    ok: true,
    json: async () => ({ status: 'ok', message })
  });

  it('normalizes the DOI input, hits the works endpoint URL-encoded, and maps the message', async () => {
    const fetchFn = vi.fn(async () => okResponse(WORK));
    const p = await fetchDoiPrefill('https://doi.org/10.1000/xyz123', /** @type {any} */ (fetchFn));
    expect(fetchFn).toHaveBeenCalledWith('https://api.crossref.org/works/10.1000%2Fxyz123');
    expect(p.title).toBe('Religionspädagogik im digitalen Raum');
  });

  it('returns {} without fetching when the DOI is invalid', async () => {
    const fetchFn = vi.fn();
    expect(await fetchDoiPrefill('not-a-doi', /** @type {any} */ (fetchFn))).toEqual({});
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('degrades to {} on HTTP error, thrown fetch and malformed body', async () => {
    const cases = [
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
      vi.fn(async () => {
        throw new Error('offline');
      }),
      vi.fn(async () => ({ ok: true, json: async () => ({ status: 'error' }) })),
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new Error('not json');
        }
      }))
    ];
    for (const fetchFn of cases) {
      expect(await fetchDoiPrefill('10.1000/xyz123', /** @type {any} */ (fetchFn))).toEqual({});
    }
  });
});
