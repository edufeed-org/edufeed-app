/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  isIndexableEvent,
  meetsQuality,
  isNoindexPath,
  isSearchIndexingEnabled,
  MIN_TEXT_WORDS
} from '$lib/server/geo/indexability.js';

const AUTHOR = 'a'.repeat(64);
const CURATED = 'b'.repeat(64);
const words = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

/** @param {number} kind @param {string[][]} tags @param {string} [content] @param {string} [pubkey] */
const ev = (kind, tags, content = '', pubkey = AUTHOR) => ({ kind, pubkey, tags, content });

const opts = { clientName: 'Edufeed', curatedAuthors: new Set([CURATED]) };

describe('meetsQuality', () => {
  it('needs enough words for articles and wiki entries', () => {
    expect(meetsQuality(ev(30023, [['title', 'T']], words(MIN_TEXT_WORDS)))).toBe(true);
    expect(meetsQuality(ev(30023, [['title', 'T']], words(MIN_TEXT_WORDS - 1)))).toBe(false);
    expect(meetsQuality(ev(30818, [['d', 'x']], words(MIN_TEXT_WORDS)))).toBe(true);
  });

  it('needs a title for articles', () => {
    expect(meetsQuality(ev(30023, [], words(500)))).toBe(false);
  });

  it('needs name and description for learning resources', () => {
    expect(
      meetsQuality(
        ev(30142, [
          ['name', 'N'],
          ['description', 'D']
        ])
      )
    ).toBe(true);
    expect(meetsQuality(ev(30142, [['name', 'N']]))).toBe(false);
    expect(meetsQuality(ev(30142, [['description', 'D']]))).toBe(false);
    expect(
      meetsQuality(
        ev(30142, [
          ['name', '  '],
          ['description', 'D']
        ])
      )
    ).toBe(false);
  });
});

describe('isIndexableEvent', () => {
  const article = (/** @type {string[][]} */ extra, pubkey = AUTHOR) =>
    ev(30023, [['title', 'T'], ...extra], words(300), pubkey);

  it('indexes content published through this deployment (client tag)', () => {
    expect(isIndexableEvent(article([['client', 'Edufeed']]), opts)).toBe(true);
    expect(isIndexableEvent(article([['client', 'edufeed']]), opts)).toBe(true);
  });

  it('indexes content by curated authors without a client tag', () => {
    expect(isIndexableEvent(article([], CURATED), opts)).toBe(true);
  });

  it('does not index other content', () => {
    expect(isIndexableEvent(article([]), opts)).toBe(false);
    expect(isIndexableEvent(article([['client', 'Yakihonne']]), opts)).toBe(false);
  });

  it('applies the quality gate to edufeed and curated content alike', () => {
    const short = ev(
      30023,
      [
        ['title', 'T'],
        ['client', 'Edufeed']
      ],
      'test',
      AUTHOR
    );
    expect(isIndexableEvent(short, opts)).toBe(false);
    expect(isIndexableEvent({ ...short, pubkey: CURATED }, opts)).toBe(false);
  });

  it('only considers articles, wiki entries and learning resources', () => {
    expect(isIndexableEvent(ev(1, [['client', 'Edufeed']], words(500)), opts)).toBe(false);
    expect(
      isIndexableEvent(
        ev(
          31923,
          [
            ['client', 'Edufeed'],
            ['title', 'T']
          ],
          words(500)
        ),
        opts
      )
    ).toBe(false);
  });

  it('indexes a resource describing an external page when published through edufeed', () => {
    const res = ev(30142, [
      ['d', 'https://example.org/material'],
      ['name', 'Material'],
      ['description', 'Eine eigene Beschreibung.'],
      ['client', 'Edufeed']
    ]);
    expect(isIndexableEvent(res, opts)).toBe(true);
    // the same metadata imported in bulk (no client tag, not curated) is not indexed
    expect(
      isIndexableEvent({ ...res, tags: res.tags.filter((t) => t[0] !== 'client') }, opts)
    ).toBe(false);
  });

  it('works without curated authors', () => {
    expect(
      isIndexableEvent(article([['client', 'Edufeed']]), {
        clientName: 'Edufeed',
        curatedAuthors: null
      })
    ).toBe(true);
    expect(
      isIndexableEvent(article([], CURATED), { clientName: 'Edufeed', curatedAuthors: null })
    ).toBe(false);
  });
});

describe('isNoindexPath', () => {
  it('marks app functions and personal areas as noindex', () => {
    for (const p of [
      '/create/article',
      '/settings',
      '/inbox',
      '/dashboard',
      '/call/x',
      '/invite/naddr1x',
      '/private/1',
      '/accounts',
      '/admin',
      '/agents',
      '/forms',
      '/groups',
      '/bookmarks/x',
      '/relays/x',
      '/c',
      '/c/agents',
      '/c/groups',
      '/c/inbox',
      '/c/messages',
      '/p/npub1x'
    ]) {
      expect(isNoindexPath(new URL(`https://e.example${p}`)), p).toBe(true);
    }
  });

  it('marks discover result variants (query string) as noindex', () => {
    expect(isNoindexPath(new URL('https://e.example/discover?type=learning&q=x'))).toBe(true);
  });

  it('leaves public entry pages indexable', () => {
    for (const p of [
      '/',
      '/discover',
      '/calendar',
      '/imprint',
      '/wiki/x',
      '/c/npub1abc',
      '/naddr1abc'
    ]) {
      expect(isNoindexPath(new URL(`https://e.example${p}`)), p).toBe(false);
    }
  });
});

describe('isSearchIndexingEnabled', () => {
  it('is on unless SEARCH_INDEXING is explicitly false', () => {
    expect(isSearchIndexingEnabled({})).toBe(true);
    expect(isSearchIndexingEnabled({ SEARCH_INDEXING: 'true' })).toBe(true);
    expect(isSearchIndexingEnabled({ SEARCH_INDEXING: 'false' })).toBe(false);
    expect(isSearchIndexingEnabled({ SEARCH_INDEXING: '0' })).toBe(false);
  });
});
