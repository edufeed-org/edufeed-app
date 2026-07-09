/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  buildPublicationTags,
  parsePublicationEvent,
  PUBLICATION_KIND
} from '$lib/helpers/publication/publicationTags.js';

/** @param {string[][]} tags @param {string} key */
const tagValue = (tags, key) => tags.find((t) => t[0] === key)?.[1];
/** @param {string[][]} tags @param {string} key */
const tagValues = (tags, key) => tags.filter((t) => t[0] === key).map((t) => t[1]);

const fullForm = {
  title: 'Open Educational Resources in Higher Education',
  abstract: 'A study on OER adoption.',
  doi: '10.5281/zenodo.569',
  url: 'https://oerf-journal.eu/index.php/oerf/article/view/569',
  journal: 'OERF Journal',
  datePublished: '2026-03-01',
  inLanguage: 'en',
  license: 'https://creativecommons.org/licenses/by/4.0/',
  keywords: ['OER', 'Hochschule'],
  creators: [
    {
      name: 'Ada Lovelace',
      type: /** @type {'Person'} */ ('Person'),
      orcid: 'https://orcid.org/0000-0002-1825-0097',
      affiliationName: 'University of Test'
    },
    { name: 'No Orcid', type: /** @type {'Person'} */ ('Person') }
  ],
  subjects: [
    { id: 'https://w3id.org/kim/hochschulfaechersystematik/n71', label: 'Erziehungswissenschaften' }
  ]
};

describe('PUBLICATION_KIND', () => {
  it('is NKBIP-01 kind 30040', () => {
    expect(PUBLICATION_KIND).toBe(30040);
  });
});

describe('buildPublicationTags', () => {
  it('emits NKBIP-01 core tags', () => {
    const tags = buildPublicationTags(fullForm, 'pub-slug');
    expect(tagValue(tags, 'd')).toBe('pub-slug');
    expect(tagValue(tags, 'title')).toBe(fullForm.title);
    expect(tagValue(tags, 'type')).toBe('academic');
    expect(tagValues(tags, 'author')).toEqual(['Ada Lovelace', 'No Orcid']);
    expect(tagValue(tags, 'i')).toBe('doi:10.5281/zenodo.569');
    expect(tagValue(tags, 'source')).toBe(fullForm.url);
    expect(tagValue(tags, 'published_on')).toBe('2026-03-01');
    expect(tagValue(tags, 'published_by')).toBe('OERF Journal');
    expect(tagValue(tags, 'summary')).toBe(fullForm.abstract);
    expect(tagValues(tags, 't')).toEqual(['OER', 'Hochschule']);
  });

  it('emits AMB-style extension tags (creators, subjects, language, license)', () => {
    const tags = buildPublicationTags(fullForm, 'pub-slug');
    // creator run 1: type, name, affiliation, orcid id
    expect(tagValues(tags, 'creator:name')).toEqual(['Ada Lovelace', 'No Orcid']);
    expect(tagValues(tags, 'creator:id')).toEqual(['https://orcid.org/0000-0002-1825-0097']);
    expect(tagValues(tags, 'creator:affiliation:name')).toEqual(['University of Test']);
    expect(tagValue(tags, 'about:id')).toBe('https://w3id.org/kim/hochschulfaechersystematik/n71');
    expect(tagValue(tags, 'about:prefLabel:en')).toBe('Erziehungswissenschaften');
    expect(tagValue(tags, 'inLanguage')).toBe('en');
    expect(tagValue(tags, 'license:id')).toBe('https://creativecommons.org/licenses/by/4.0/');
  });

  it('creator:id follows its creator run so heterogeneous ORCIDs stay attributable', () => {
    const tags = buildPublicationTags(fullForm, 'pub-slug');
    const creatorTags = tags.filter((t) => t[0].startsWith('creator:'));
    const idIdx = creatorTags.findIndex((t) => t[0] === 'creator:id');
    const secondNameIdx = creatorTags.findIndex((t) => t[1] === 'No Orcid');
    expect(idIdx).toBeGreaterThan(-1);
    expect(idIdx).toBeLessThan(secondNameIdx);
  });

  it('omits empty optional fields entirely', () => {
    const tags = buildPublicationTags(
      { title: 'Minimal', creators: [], keywords: [], subjects: [] },
      'min-slug'
    );
    for (const key of [
      'i',
      'source',
      'published_on',
      'published_by',
      'summary',
      't',
      'about:id',
      'license:id',
      'author'
    ]) {
      expect(tagValues(tags, key)).toEqual([]);
    }
    expect(tagValue(tags, 'title')).toBe('Minimal');
  });

  it('generates a d tag when none is provided', () => {
    const tags = buildPublicationTags({ title: 'X', creators: [], keywords: [], subjects: [] });
    expect(tagValue(tags, 'd')).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe('parsePublicationEvent', () => {
  it('round-trips the full form', () => {
    const event = {
      kind: PUBLICATION_KIND,
      tags: buildPublicationTags(fullForm, 'pub-slug'),
      content: '',
      pubkey: 'pk'
    };
    const parsed = parsePublicationEvent(event);
    expect(parsed.title).toBe(fullForm.title);
    expect(parsed.abstract).toBe(fullForm.abstract);
    expect(parsed.doi).toBe('10.5281/zenodo.569');
    expect(parsed.url).toBe(fullForm.url);
    expect(parsed.journal).toBe('OERF Journal');
    expect(parsed.datePublished).toBe('2026-03-01');
    expect(parsed.inLanguage).toBe('en');
    expect(parsed.license).toBe(fullForm.license);
    expect(parsed.keywords).toEqual(['OER', 'Hochschule']);
    expect(parsed.subjects).toEqual(fullForm.subjects);
    expect(parsed.creators).toEqual([
      {
        name: 'Ada Lovelace',
        type: 'Person',
        orcid: 'https://orcid.org/0000-0002-1825-0097',
        affiliationName: 'University of Test'
      },
      { name: 'No Orcid', type: 'Person' }
    ]);
  });

  it('parses author-only events (no creator:* extension tags)', () => {
    const event = {
      kind: PUBLICATION_KIND,
      tags: [
        ['d', 'x'],
        ['title', 'T'],
        ['author', 'Solo Author']
      ],
      content: '',
      pubkey: 'pk'
    };
    const parsed = parsePublicationEvent(event);
    expect(parsed.creators).toEqual([{ name: 'Solo Author', type: 'Person' }]);
  });

  it('ignores non-ORCID creator ids', () => {
    const event = {
      kind: PUBLICATION_KIND,
      tags: [
        ['d', 'x'],
        ['title', 'T'],
        ['creator:type', 'Person'],
        ['creator:name', 'A'],
        ['creator:id', 'https://d-nb.info/gnd/123']
      ],
      content: '',
      pubkey: 'pk'
    };
    expect(parsePublicationEvent(event).creators).toEqual([{ name: 'A', type: 'Person' }]);
  });
});

describe('article file (encoding tags)', () => {
  it('emits one encoding run for the article file', () => {
    const tags = buildPublicationTags(
      {
        title: 'T',
        creators: [],
        keywords: [],
        subjects: [],
        file: {
          url: 'https://blossom.example/abc.pdf',
          mimeType: 'application/pdf',
          size: 12345,
          sha256: 'deadbeef'
        }
      },
      'd1'
    );
    expect(tags.filter((t) => t[0] === 'encoding:contentUrl')).toEqual([
      ['encoding:contentUrl', 'https://blossom.example/abc.pdf']
    ]);
    expect(tags.find((t) => t[0] === 'encoding:encodingFormat')?.[1]).toBe('application/pdf');
    expect(tags.find((t) => t[0] === 'encoding:contentSize')?.[1]).toBe('12345');
    expect(tags.find((t) => t[0] === 'encoding:sha256')?.[1]).toBe('deadbeef');
  });

  it('emits url-only encodings without format/size/sha tags', () => {
    const tags = buildPublicationTags(
      {
        title: 'T',
        creators: [],
        keywords: [],
        subjects: [],
        file: { url: 'https://journal.example/download/569/493' }
      },
      'd1'
    );
    expect(tags.find((t) => t[0] === 'encoding:contentUrl')?.[1]).toBe(
      'https://journal.example/download/569/493'
    );
    expect(tags.find((t) => t[0] === 'encoding:encodingFormat')).toBeUndefined();
    expect(tags.find((t) => t[0] === 'encoding:contentSize')).toBeUndefined();
  });

  it('omits encoding tags when no file is set', () => {
    const tags = buildPublicationTags(
      { title: 'T', creators: [], keywords: [], subjects: [] },
      'd1'
    );
    expect(tags.find((t) => t[0].startsWith('encoding:'))).toBeUndefined();
  });

  it('round-trips the file through parsePublicationEvent', () => {
    const form = {
      title: 'T',
      creators: [],
      keywords: [],
      subjects: [],
      file: { url: 'https://x.example/a.pdf', mimeType: 'application/pdf', size: 7, sha256: 'ff' }
    };
    const event = { kind: PUBLICATION_KIND, tags: buildPublicationTags(form, 'd1'), content: '' };
    expect(parsePublicationEvent(event).file).toEqual(form.file);
  });

  it('parses url-only encodings back without invented fields', () => {
    const event = {
      kind: PUBLICATION_KIND,
      tags: [
        ['d', 'x'],
        ['title', 'T'],
        ['encoding:contentUrl', 'https://x.example/dl/1']
      ],
      content: ''
    };
    expect(parsePublicationEvent(event).file).toEqual({ url: 'https://x.example/dl/1' });
  });
});
