/**
 * Authorship, license and TULLU provenance on NIP-23 articles (kind 30023).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  getArticlePeople,
  getArticleProvenance,
  getArticleAttribution,
  articlePeopleToForm
} from '$lib/helpers/article-attribution.js';

const PUBLISHER = 'a'.repeat(64);
const CORINNA = 'b'.repeat(64);
const MENTIONED = 'c'.repeat(64);

/** @param {string[][]} tags */
const article = (tags) => ({
  kind: 30023,
  pubkey: PUBLISHER,
  created_at: 1,
  content: '',
  tags: [['d', 'x'], ['title', 'Beitrag'], ...tags]
});

describe('getArticlePeople', () => {
  it('reads creator p-tags and flattened creator runs in wire order', () => {
    const event = article([
      ['creator:type', 'Person'],
      ['creator:name', 'Corinna Beispiel'],
      ['p', CORINNA, 'wss://relay.example', 'creator']
    ]);
    expect(getArticlePeople(event)).toEqual([
      { name: 'Corinna Beispiel', type: 'Person', role: 'creator' },
      { pubkey: CORINNA, role: 'creator' }
    ]);
  });

  it('ignores unmarked p-tags (body mentions on an article)', () => {
    const event = article([['p', MENTIONED, 'wss://relay.example']]);
    expect(getArticlePeople(event)).toEqual([]);
  });

  it('keeps contributors with their role', () => {
    const event = article([
      ['contributor:type', 'Person'],
      ['contributor:name', 'Gina'],
      ['p', MENTIONED, '', 'contributor']
    ]);
    expect(getArticlePeople(event)).toEqual([
      { name: 'Gina', type: 'Person', role: 'contributor' },
      { pubkey: MENTIONED, role: 'contributor' }
    ]);
  });

  it('lists all creators before the contributors, linked people after named ones', () => {
    const event = article([
      ['contributor:name', 'Gina'],
      ['creator:name', 'Corinna'],
      ['p', MENTIONED, '', 'contributor'],
      ['p', CORINNA, '', 'creator']
    ]);
    expect(getArticlePeople(event).map((p) => p.name || p.pubkey)).toEqual([
      'Corinna',
      CORINNA,
      'Gina',
      MENTIONED
    ]);
  });

  it('dedupes repeated runs and malformed pubkeys', () => {
    const event = article([
      ['creator:name', 'Corinna'],
      ['creator:name', 'Corinna'],
      ['p', 'not-a-pubkey', '', 'creator'],
      ['p', CORINNA, '', 'creator'],
      ['p', CORINNA.toUpperCase(), '', 'creator']
    ]);
    expect(getArticlePeople(event)).toEqual([
      { name: 'Corinna', role: 'creator' },
      { pubkey: CORINNA, role: 'creator' }
    ]);
  });
});

describe('getArticleProvenance', () => {
  it('returns nulls for an article without provenance tags', () => {
    expect(getArticleProvenance(article([]))).toEqual({
      license: null,
      source: null,
      changes: null
    });
  });

  it('reads license (labelled), source URL and modification note', () => {
    const event = article([
      ['license:id', 'https://creativecommons.org/licenses/by-sa/4.0/'],
      ['source', 'https://blog.example.org/beitrag'],
      ['changes', 'geändert von Gina, Links ausgetauscht']
    ]);
    expect(getArticleProvenance(event)).toEqual({
      license: { id: 'https://creativecommons.org/licenses/by-sa/4.0/', label: 'CC BY-SA 4.0' },
      source: 'https://blog.example.org/beitrag',
      changes: 'geändert von Gina, Links ausgetauscht'
    });
  });

  it('drops a license that is not an http(s) URL (it is rendered as a link)', () => {
    expect(
      getArticleProvenance(article([['license:id', 'javascript:alert(1)']])).license
    ).toBeNull();
  });

  it('drops a source that is not an http(s) URL', () => {
    expect(getArticleProvenance(article([['source', 'javascript:alert(1)']])).source).toBeNull();
  });
});

describe('getArticleAttribution', () => {
  it('is own content when no creators are credited', () => {
    expect(getArticleAttribution(article([]), null)).toEqual({ indexed: false, creators: [] });
  });

  it('credits a foreign creator as the byline', () => {
    const event = article([['p', CORINNA, '', 'creator']]);
    expect(getArticleAttribution(event, null)).toEqual({
      indexed: true,
      creators: [{ pubkey: CORINNA }]
    });
  });

  it('stays own content when the publisher credits themselves', () => {
    const event = article([['p', PUBLISHER, '', 'creator']]);
    expect(getArticleAttribution(event, null).indexed).toBe(false);
  });

  it('stays own content when a name-only creator matches the publisher profile', () => {
    const event = article([['creator:name', 'Jörg']]);
    expect(getArticleAttribution(event, { name: 'jörg' }).indexed).toBe(false);
  });

  it('never promotes a contributor or a body mention to the byline', () => {
    const event = article([
      ['p', MENTIONED],
      ['contributor:name', 'Gina']
    ]);
    expect(getArticleAttribution(event, null).indexed).toBe(false);
  });
});

describe('articlePeopleToForm', () => {
  it('maps wire people back to CreatorInput entries', () => {
    const event = article([
      ['creator:type', 'Organization'],
      ['creator:name', 'Lehrerzimmer e.V.'],
      ['creator:affiliation:name', 'Verband'],
      ['creator:honorificPrefix', 'Dr.'],
      ['creator:id', 'https://orcid.org/0000-0002-1825-0097'],
      ['p', CORINNA, '', 'creator'],
      ['p', MENTIONED, '', 'contributor']
    ]);
    expect(articlePeopleToForm(event)).toEqual([
      {
        name: 'Lehrerzimmer e.V.',
        type: 'Organization',
        affiliationName: 'Verband',
        honorificPrefix: 'Dr.',
        orcid: 'https://orcid.org/0000-0002-1825-0097'
      },
      { name: '', type: 'Person', pubkey: CORINNA },
      { name: '', type: 'Person', pubkey: MENTIONED, role: 'contributor' }
    ]);
  });
});
