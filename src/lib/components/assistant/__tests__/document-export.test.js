/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  isDocumentAnswer,
  buildSourcesSection,
  documentMarkdown,
  documentTitle,
  documentFilename,
  articleDraft,
  stashArticlePrefill,
  takeArticlePrefill,
  withoutHtmlComments,
  liascriptCourseUrl
} from '../document-export.js';

const words = (/** @type {number} */ n) => Array.from({ length: n }, () => 'Wort').join(' ');

/** @typedef {import('$lib/server/termi/items.js').Item} Item */

/** @type {Item[]} */
const ITEMS = [
  {
    type: 'resource',
    id: 'a',
    title: 'Aktivierende Methoden',
    creator: 'Anna A.',
    publisher: 'HU Berlin',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://example.org/a'
  },
  {
    type: 'passage',
    id: 'chunk-a',
    title: 'Aktivierende Methoden (Abschnitt)',
    sourceUrl: 'https://example.org/a'
  },
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
  it('de: deduped by URL, licence URL, licence fallback, absolute href, bare items', () => {
    expect(buildSourcesSection(ITEMS, 'de')).toBe(
      [
        '## Quellen und Lizenzen',
        '',
        '- Aktivierende Methoden — Anna A. (HU Berlin), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), https://example.org/a',
        `- Think-Pair-Share — Bea B., Lizenz nicht angegeben, ${location.origin}/naddr1b`,
        '- Lernen sichtbar machen, CC0, https://example.org/p',
        '- Ohne Link, Lizenz nicht angegeben'
      ].join('\n')
    );
  });
  it('en heading and licence fallback', () => {
    const out = buildSourcesSection([ITEMS[4]], 'en');
    expect(out).toBe('## Sources and licenses\n\n- Ohne Link, license not stated');
  });
  it('passages of one page collapse; later ones fill missing attribution', () => {
    const p = /** @type {const} */ ({ type: 'passage', title: 'T', sourceUrl: 'https://x.org/' });
    expect(
      buildSourcesSection(
        [
          { ...p, id: '1' },
          { ...p, id: '2', creator: 'Lea', license: 'CC0' },
          { ...p, id: '3', creator: 'Max', publisher: 'Uni' }
        ],
        'de'
      )
    ).toBe('## Quellen und Lizenzen\n\n- T — Lea (Uni), CC0, https://x.org/');
  });
});

describe('documentMarkdown', () => {
  it('appends the sources section after the trimmed text', () => {
    expect(documentMarkdown('# T\n\nText\n\n', [ITEMS[4]], 'de')).toBe(
      '# T\n\nText\n\n## Quellen und Lizenzen\n\n- Ohne Link, Lizenz nicht angegeben'
    );
  });
  it('model-written links and images keep only their text, raw <a>/<img> go', () => {
    expect(
      documentMarkdown(
        'Siehe [Quelle](https://evil.example) und ![Bild](https://x/y.png) <a href="z">hier</a><img src=x>',
        [],
        'de'
      )
    ).toBe('Siehe Quelle und Bild hier');
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
    expect(documentFilename('# Ärger über Öl, Maß')).toBe('termi-aerger-ueber-oel-mass.md');
    expect(documentFilename(`# ${'lang '.repeat(30)}`)).toBe(
      `termi-${'lang-'.repeat(12).slice(0, 59)}.md`
    );
    expect(documentFilename('# !!!')).toBe('termi-dokument.md');
  });
});

describe('articleDraft', () => {
  it('the title goes to its field, the content drops the # line and keeps the sources', () => {
    expect(articleDraft('# Titel\n\n## A\n\nText', [ITEMS[4]], 'de')).toEqual({
      title: 'Titel',
      content: '## A\n\nText\n\n## Quellen und Lizenzen\n\n- Ohne Link, Lizenz nicht angegeben'
    });
  });
  it('a document without a # line keeps its whole text', () => {
    expect(articleDraft('## A\nText', [], 'de').content).toBe('## A\nText');
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

const LIA = '<!--\nauthor: edufeed Termi\nversion: 1.0.0\n-->\n\n# Kurs\n\nText';

describe('LiaScript', () => {
  it('a leading header comment does not hide a document heading', () => {
    expect(isDocumentAnswer(LIA)).toBe(true);
    expect(isDocumentAnswer('<!-- x -->\nkurz')).toBe(false);
  });

  it('display drops HTML comments, the export keeps them', () => {
    expect(withoutHtmlComments(`${LIA}\n<!-- note -->`)).toBe('# Kurs\n\nText');
    expect(documentMarkdown(LIA, [], 'de')).toBe(LIA);
  });

  it('course link: the player loads the naddr from Nostr', () => {
    expect(liascriptCourseUrl('naddr1a')).toBe('https://liascript.github.io/course/?nostr:naddr1a');
  });
});

describe('LiaScript author', () => {
  const HEAD = '<!--\nauthor:\nversion: 1.0.0\n-->\n\n# Kurs\n\nText';

  it('fills the empty author line of the leading header with the user name', () => {
    expect(documentMarkdown(HEAD, [], 'de', 'Anna --> A.')).toBe(
      '<!--\nauthor: Anna - A.\nversion: 1.0.0\n-->\n\n# Kurs\n\nText'
    );
  });

  it('drops the empty author line without a name, leaves other text alone', () => {
    expect(documentMarkdown(HEAD, [], 'de')).toBe('<!--\nversion: 1.0.0\n-->\n\n# Kurs\n\nText');
    expect(documentMarkdown('# T\n\nauthor:\n', [], 'de', 'Anna')).toBe('# T\n\nauthor:');
  });

  it('the article draft gets the name too', () => {
    expect(articleDraft(HEAD, [], 'de', 'Anna').content).toContain('author: Anna\n');
  });
});
