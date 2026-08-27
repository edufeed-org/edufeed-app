import { describe, it, expect } from 'vitest';
import { parseChatMarkdown, safeHref } from '$lib/helpers/chatMarkdown.js';

const NPUB = 'npub1r30l8j4vmppvq8w23umcyvd3vct4zmfpfkn4c7h2h057rmlfcrmq9xt9ma';

/** @param {string} content @param {string[][]} [tags] @returns {any} */
function ev(content, tags = []) {
  return {
    id: 'e'.repeat(64),
    pubkey: 'a'.repeat(64),
    sig: 's'.repeat(128),
    created_at: 0,
    kind: 9,
    content,
    tags
  };
}

describe('parseChatMarkdown — code is opaque to the nostr parser', () => {
  it('keeps a nostr entity inside a fenced block byte-identical to the source', () => {
    const { blocks } = parseChatMarkdown(ev('```\nnostr:' + NPUB + '\n```'));

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('code');
    // Byte-identity, NOT "no anchor was produced": preprocessNostrMentions
    // corrupts fenced content into `[npub…](/npub…)` while still emitting no
    // anchor, so an absence-of-link assertion passes green on mangled text.
    expect(blocks[0].text).toBe('nostr:' + NPUB);
  });

  it('keeps a nostr entity inside an inline code span byte-identical', () => {
    const { blocks } = parseChatMarkdown(ev('see `nostr:' + NPUB + '` there'));
    const spans = blocks[0].children.filter((/** @type {any} */ c) => c.type === 'codespan');

    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe('nostr:' + NPUB);
  });

  it('still parses a nostr entity in ordinary prose', () => {
    const { blocks } = parseChatMarkdown(ev('hello nostr:' + NPUB + ' bye'));
    const nodes = blocks[0].children.flatMap((/** @type {any} */ c) =>
      c.type === 'nostr' ? c.nodes : []
    );

    expect(nodes.some((/** @type {any} */ n) => n.type === 'mention')).toBe(true);
  });
});

describe('parseChatMarkdown — the shipped subset', () => {
  it('marks up bold, italic and strikethrough', () => {
    const { blocks } = parseChatMarkdown(ev('**b** _i_ ~~s~~'));
    const types = blocks[0].children.map((/** @type {any} */ c) => c.type);

    expect(types).toContain('strong');
    expect(types).toContain('em');
    expect(types).toContain('del');
  });

  it('renders a blockquote as a block with nested content', () => {
    const { blocks } = parseChatMarkdown(ev('> quoted'));

    expect(blocks[0].type).toBe('blockquote');
    expect(blocks[0].children[0].type).toBe('paragraph');
  });

  it('renders unordered and ordered lists with their items', () => {
    const { blocks: ul } = parseChatMarkdown(ev('- one\n- two'));
    const { blocks: ol } = parseChatMarkdown(ev('1. one\n2. two'));

    expect(ul[0].type).toBe('list');
    expect(ul[0].ordered).toBe(false);
    expect(ul[0].items).toHaveLength(2);
    expect(ol[0].ordered).toBe(true);
  });
});

describe('parseChatMarkdown — everything outside the subset is literal text', () => {
  it.each([
    ['heading', '# Not a heading'],
    ['horizontal rule', '---'],
    ['raw html', '<b>raw</b>']
  ])('renders a %s as the literal source text', (_label, source) => {
    const { blocks } = parseChatMarkdown(ev(source));
    const text = blocks
      .flatMap((/** @type {any} */ b) => b.children ?? [])
      .flatMap((/** @type {any} */ c) => (c.type === 'nostr' ? c.nodes : []))
      .filter((/** @type {any} */ n) => n.type === 'text')
      .map((/** @type {any} */ n) => n.value)
      .join('');

    expect(text.trim()).toBe(source);
  });

  // A markdown image cannot be kept literal: applesauce linkifies the URL
  // inside it whatever we do, so "literal" would render `![alt](` + the image
  // + `)`. Degrading to the bare URL gives the reader exactly what pasting
  // that URL gives them, and still never emits an <img> from markdown.
  it('degrades a markdown image to its bare URL, not to literal text', () => {
    const { nodes } = parseChatMarkdown(ev('![alt](https://example.com/a.png)'));

    expect(nodes.map((/** @type {any} */ n) => n.type)).toEqual(['link']);
    expect(nodes[0].href).toBe('https://example.com/a.png');
  });
});

describe('parseChatMarkdown — untrusted input', () => {
  it.each([
    ['javascript:', '[click](javascript:alert(1))'],
    ['data:', '[click](data:text/html,<script>alert(1)</script>)'],
    ['vbscript:', '[click](vbscript:msgbox(1))']
  ])('refuses to link a %s href and shows the source instead', (_label, source) => {
    const { blocks } = parseChatMarkdown(ev(source));
    const links = blocks[0].children.filter((/** @type {any} */ c) => c.type === 'link');

    expect(links).toEqual([]);
  });

  it.each([
    ['https', '[ok](https://example.com/x)', 'https://example.com/x'],
    ['mailto', '[mail](mailto:a@b.c)', 'mailto:a@b.c'],
    ['in-app relative', '[wiki](/wiki/peace)', '/wiki/peace'],
    ['nostr entity', `[who](nostr:${NPUB})`, `/${NPUB}`]
  ])('links a %s href', (_label, source, expected) => {
    const { blocks } = parseChatMarkdown(ev(source));
    const links = blocks[0].children.filter((/** @type {any} */ c) => c.type === 'link');

    expect(links).toHaveLength(1);
    expect(links[0].href).toBe(expected);
  });

  // `//` is NOT the only authority-relative form a browser accepts. Chrome
  // normalises `\` to `/` and strips TAB/CR/LF from an href outright, so all
  // of these leave the origin while looking like in-app paths. A regex that
  // closes the backslash pair still lets the TAB through — the guard has to
  // parse, not pattern-match. Found by TestOER in Chrome at 3bb89b61.
  it.each([
    ['protocol-relative', '//evil.example'],
    ['backslash', '/\\evil.example'],
    ['double backslash', '/\\\\evil.example'],
    ['tab', '/\t/evil.example'],
    ['carriage return', '/\r/evil.example'],
    ['newline', '/\n/evil.example'],
    ['backslash-slash', '/\\/evil.example']
  ])('treats a %s href as unsafe', (_label, href) => {
    expect(safeHref(href)).toBeNull();
  });

  it.each([
    ['plain path', '/wiki/peace', '/wiki/peace'],
    ['entity route', '/npub1abc', '/npub1abc'],
    ['query and hash', '/a/b?c=1#d', '/a/b?c=1#d']
  ])('keeps a same-origin %s', (_label, href, expected) => {
    expect(safeHref(href)).toBe(expected);
  });

  it('does not linkify an off-origin path smuggled through chat content', () => {
    // Asserted past the last gate: through parseChatMarkdown, not the helper.
    // The angle-bracket destination form is what lets whitespace survive.
    for (const source of ['[c](/\\evil.example)', '[c](</\t/evil.example>)']) {
      const { blocks } = parseChatMarkdown(ev(source));
      const links = blocks[0].children.filter((/** @type {any} */ c) => c.type === 'link');
      expect(links, source).toEqual([]);
    }
  });

  it('does not lose an ampersand to double-escaping', () => {
    const { nodes } = parseChatMarkdown(ev('Tom & Jerry'));

    expect(nodes.map((/** @type {any} */ n) => n.value).join('')).toBe('Tom & Jerry');
  });

  it('keeps angle brackets inside a code span', () => {
    const { blocks } = parseChatMarkdown(ev('`<script>`'));
    const span = blocks[0].children.find((/** @type {any} */ c) => c.type === 'codespan');

    expect(span.text).toBe('<script>');
  });
});

describe('parseChatMarkdown — lightbox offsets survive nesting', () => {
  it('numbers nostr runs by their position in the flat node list', () => {
    const { blocks, nodes } = parseChatMarkdown(
      ev('https://example.com/a.png\n\n> https://example.com/b.png')
    );
    const runs = [...blocks[0].children, ...blocks[1].children[0].children].filter(
      (/** @type {any} */ c) => c.type === 'nostr'
    );

    expect(runs.map((/** @type {any} */ r) => r.offset)).toEqual([0, 1]);
    expect(nodes).toHaveLength(2);
    expect(nodes.every((/** @type {any} */ n) => n.type === 'link')).toBe(true);
  });
});

// laoc, 2026-08-11 live feedback: pipe tables are pasted into channels as
// design docs and must render — overriding the original "no tables in a
// bubble" cut. GFM table → a table block with inline runs per cell.
describe('tables', () => {
  it('parses a GFM table into header and row cell runs', () => {
    const md = parseChatMarkdown(ev('| a | b |\n|---|---:|\n| **x** | y |'));
    const table = md.blocks.find((b) => b.type === 'table');
    expect(table).toBeTruthy();
    expect(table.header).toHaveLength(2);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toHaveLength(2);
    expect(table.align[1]).toBe('right');
    // Inline markdown inside a cell stays markdown
    expect(JSON.stringify(table.rows[0][0])).toContain('strong');
  });

  it('leaves non-table pipes as literal text', () => {
    const md = parseChatMarkdown(ev('a | b | c'));
    expect(md.blocks.some((b) => b.type === 'table')).toBe(false);
  });
});
