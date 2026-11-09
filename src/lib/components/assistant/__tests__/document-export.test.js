/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  isDocumentAnswer,
  buildSourcesSection,
  documentMarkdown,
  documentTitle,
  documentFilename,
  stashArticlePrefill,
  takeArticlePrefill
} from '../document-export.js';

const words = (/** @type {number} */ n) => Array.from({ length: n }, () => 'Wort').join(' ');

const ITEMS = [
  {
    type: 'resource',
    id: 'a',
    title: 'Aktivierende Methoden',
    creator: 'Anna A.',
    publisher: 'HU Berlin',
    license: 'CC BY 4.0',
    sourceUrl: 'https://example.org/a'
  },
  { type: 'resource', id: 'a', title: 'Aktivierende Methoden (Duplikat)' },
  { type: 'resource', id: 'b', title: 'Think-Pair-Share', creator: 'Bea B.', href: '/naddr1b' },
  {
    type: 'passage',
    id: 'chunk-1',
    title: 'Lernen sichtbar machen',
    license: 'CC0',
    sourceUrl: 'https://example.org/p'
  },
  { type: 'resource', id: 'c', title: 'Ohne Link' }
];

describe('isDocumentAnswer', () => {
  it('a leading # heading is a document', () => {
    expect(isDocumentAnswer('  # Titel\n\nText')).toBe(true);
  });
  it('250 words are a document, 249 are not', () => {
    expect(isDocumentAnswer(words(250))).toBe(true);
    expect(isDocumentAnswer(words(249))).toBe(false);
  });
  it('a short answer or a ## heading is not', () => {
    expect(isDocumentAnswer('Hier sind Treffer.')).toBe(false);
    expect(isDocumentAnswer('## Abschnitt\nkurz')).toBe(false);
    expect(isDocumentAnswer('')).toBe(false);
  });
});

describe('buildSourcesSection', () => {
  it('de: deduped by id, licence fallback, absolute href, items without url listed bare', () => {
    expect(buildSourcesSection(ITEMS, 'de')).toBe(
      [
        '## Quellen und Lizenzen',
        '',
        '- Aktivierende Methoden — Anna A. (HU Berlin), CC BY 4.0, https://example.org/a',
        `- Think-Pair-Share — Bea B., Lizenz nicht angegeben, ${location.origin}/naddr1b`,
        '- Lernen sichtbar machen, CC0, https://example.org/p',
        '- Ohne Link, Lizenz nicht angegeben'
      ].join('\n')
    );
  });
  it('en heading and licence fallback', () => {
    const out = buildSourcesSection([ITEMS[4]], 'en');
    expect(out).toBe('## Sources and licences\n\n- Ohne Link, licence not stated');
  });
  it('passages of one resource collapse into one line', () => {
    const p = { type: 'passage', title: 'T', sourceUrl: 'https://x.org/' };
    expect(
      buildSourcesSection(
        [
          { ...p, id: '1' },
          { ...p, id: '2' }
        ],
        'de'
      ).split('\n- ')
    ).toHaveLength(2);
  });
});

describe('documentMarkdown', () => {
  it('appends the sources section after the trimmed text', () => {
    expect(documentMarkdown('# T\n\nText\n\n', [ITEMS[4]], 'de')).toBe(
      '# T\n\nText\n\n## Quellen und Lizenzen\n\n- Ohne Link, Lizenz nicht angegeben'
    );
  });
  it('no items, no sources section', () => {
    expect(documentMarkdown(' # T\n', [], 'de')).toBe('# T');
  });
});

describe('documentTitle / documentFilename', () => {
  it('the first # heading', () => {
    expect(documentTitle('Vorwort\n# Studierende aktivieren\n## A')).toBe('Studierende aktivieren');
  });
  it('else the first 60 characters', () => {
    expect(documentTitle(words(30))).toBe(words(30).slice(0, 60).trim());
  });
  it('filename termi-<slug>.md', () => {
    expect(documentFilename('# Titel')).toBe('termi-titel.md');
    expect(documentFilename('# Ärger über Öl')).toBe('termi-arger-uber-ol.md');
    expect(documentFilename('# !!!')).toBe('termi-dokument.md');
  });
});

describe('article prefill handoff', () => {
  beforeEach(() => sessionStorage.clear());
  it('round-trips once', () => {
    stashArticlePrefill({ title: 'T', content: 'C' });
    expect(takeArticlePrefill()).toEqual({ title: 'T', content: 'C' });
    expect(takeArticlePrefill()).toBeNull();
  });
  it('rejects malformed data', () => {
    sessionStorage.setItem('termi.article-prefill', '{"title":1}');
    expect(takeArticlePrefill()).toBeNull();
    sessionStorage.setItem('termi.article-prefill', 'nope');
    expect(takeArticlePrefill()).toBeNull();
  });
});
