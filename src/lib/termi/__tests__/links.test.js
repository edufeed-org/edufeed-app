/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { Marked } from 'marked';
import { renderMarkdown } from '$lib/helpers/markdown.js';
import { allowedLinks, safeLinks, linkPredicate, linkKit, onLinkClick } from '../links.js';

const ORIGIN = 'https://app.example';
const NADDR = '/naddr1qqxnzd3cxqmrzv3exgmr2wfeqy2hwumn8ghx7un8qg';
const turns = [
  { role: 'user', text: 'x', tier: 1 },
  {
    role: 'assistant',
    text: '',
    tier: 1,
    items: [
      { type: 'resource', id: 'a', title: 'A', href: NADDR, sourceUrl: 'https://src.org/a' },
      { type: 'community', id: 'c', title: 'C', href: '/c/npub1abc' },
      {
        type: 'passage',
        id: 'p',
        title: 'P',
        href: 'https://pass.org/p?x=1&y=2',
        sourceUrl: 'https://pass.org/p?x=1&y=2'
      }
    ]
  },
  {
    role: 'assistant',
    text: '',
    tier: 2,
    toolParts: [
      {
        type: 'dynamic-tool',
        toolName: 'search_content',
        state: 'output-available',
        output: { items: [{ type: 'event', id: 'e', title: 'E', href: '/naddr1event' }] }
      }
    ]
  }
];
const allowed = allowedLinks(turns, ORIGIN);
const safe = (/** @type {string} */ md) => safeLinks(md, allowed, ORIGIN);

/** Every hostile input of this file; the last block checks each one's final output. @type {string[]} */
const HOSTILE = [];
/** Registers an `it.each` table's inputs (a string row, or `[name, md]`). @template T @param {T[]} rows */
const H = (rows) => {
  for (const r of rows) HOSTILE.push(Array.isArray(r) ? r[1] : /** @type {string} */ (r));
  return rows;
};

describe('allowedLinks', () => {
  it('collects tool-result hrefs and external urls of both turn shapes', () => {
    for (const u of [
      NADDR,
      '/c/npub1abc',
      '/naddr1event',
      'https://src.org/a',
      'https://pass.org/p?x=1&y=2'
    ])
      expect(allowed.has(u)).toBe(true);
  });
  it('an old record without items or tool parts allows nothing', () => {
    expect(
      allowedLinks([{ role: 'assistant', text: 'hi [x](/naddr1abc)', tier: 2 }], ORIGIN).size
    ).toBe(0);
    expect(allowedLinks([], ORIGIN).size).toBe(0);
  });
});

describe('safeLinks', () => {
  it('keeps a known in-app, external and own-origin target', () => {
    expect(safe(`[A](${NADDR})`)).toBe(`[A](${NADDR})`);
    expect(safe('[S](https://src.org/a)')).toBe('[S](https://src.org/a)');
    expect(safe(`[A](${ORIGIN}${NADDR})`)).toBe(`[A](${NADDR})`);
    // one canonical form: no title, no angle brackets
    expect(safe('[S](https://src.org/a "Titel")')).toBe('[S](https://src.org/a)');
    expect(safe('[P](<https://pass.org/p?x=1&y=2>)')).toBe('[P](https://pass.org/p?x=1&y=2)');
  });
  it.each(
    H([
      ['unknown', '[t](https://evil.example/x)'],
      ['javascript', '[t](javascript:alert(1))'],
      ['mixed case javascript', '[t](JaVaScript:alert(1))'],
      ['data', '[t](data:text/html;base64,AAAA)'],
      ['vbscript', '[t](vbscript:x)'],
      ['protocol-relative', '[t](//evil.example)'],
      ['backslash host', '[t](/\\evil.example)'],
      ['control char', '[t](<https://src.org/a\u0001>)'],
      ['whitespace', '[t](<https://src.org/a x>)'],
      ['prefix of allowed', '[t](https://src.org/aevil)'],
      ['allowed as prefix of in-app', `[t](${NADDR}x)`],
      ['own origin lookalike', `[t](${ORIGIN}.evil.example${NADDR})`],
      ['unknown in-app', '[t](/naddr1invented)'],
      ['link in code in text', '[`t`](https://evil.example)']
    ])
  )('%s -> its text', (_n, md) => {
    const out = safe(md);
    expect(out).not.toMatch(/\]\(|evil|javascript|data:|vbscript/i);
    expect(out).toContain('t');
  });
  it('reference-style: resolved to the inline form, every definition dropped', () => {
    const out = safe(
      'See [Foo][b] and [b] and [x][].\n\n[b]: https://evil.example\n[x]: https://src.org/a'
    );
    expect(out).not.toContain('evil');
    expect(out).toContain('See Foo and b and [x](https://src.org/a).');
    expect(out).not.toContain(']:');
  });
  it('autolinks become their visible text (the renderer decides about bare urls)', () => {
    expect(safe('<https://src.org/a>')).toBe('https://src.org/a');
    expect(safe('<https://evil.example>')).not.toContain('<');
    expect(safe('<javascript:alert(1)>')).not.toContain('<');
    expect(safe('<me@evil.example>')).not.toContain('<');
  });
  it('images become their alt text, raw <a>/<img> tags are escaped to text', () => {
    expect(safe('![Bild](https://src.org/a)')).toBe('Bild');
    expect(safe('x <a href="javascript:1" onclick="x">Klick</a> <img src=x onerror=y> y')).toBe(
      'x &lt;a href="javascript:1" onclick="x">Klick&lt;/a> &lt;img src=x onerror=y> y'
    );
  });
  it('leaves code and plain text alone', () => {
    const md = 'Text `[a](https://evil.example)` und\n\n```\n[b](https://evil.example)\n```\n';
    expect(safe(md)).toBe(md);
  });
  it('balanced parentheses inside the target', () => {
    const a = allowedLinks(
      [
        {
          role: 'assistant',
          text: '',
          tier: 1,
          items: [
            { type: 'resource', id: 'w', title: 'w', href: 'https://de.wikipedia.org/wiki/A_(B)' }
          ]
        }
      ],
      ORIGIN
    );
    expect(safeLinks('[w](https://de.wikipedia.org/wiki/A_(B))', a, ORIGIN)).toBe(
      '[w](https://de.wikipedia.org/wiki/A_%28B%29)'
    );
  });
});

describe('linkPredicate', () => {
  const ok = linkPredicate(allowed, ORIGIN);
  it('matches exactly, after the light normalisation', () => {
    expect(ok(NADDR)).toBe(true);
    expect(ok(` ${ORIGIN}${NADDR} `)).toBe(true);
    expect(ok('https://src.org/a')).toBe(true);
    expect(ok('https://src.org/a/')).toBe(false);
    expect(ok('javascript:alert(1)')).toBe(false);
    expect(ok('//src.org/a')).toBe(false);
  });
});

describe('linkKit', () => {
  it('exported = validated, then absolute', () => {
    const kit = linkKit(turns, ORIGIN);
    expect(kit.exported(`[A](${NADDR}) [x](/naddr1invented)`)).toBe(`[A](${ORIGIN}${NADDR}) x`);
    expect(kit.ok(NADDR)).toBe(true);
  });
});

describe('onLinkClick', () => {
  /** @param {string} href @param {object} [init] */
  const click = (href, init = {}, attrs = /** @type {Record<string, string>} */ ({})) => {
    const a = {
      getAttribute: (/** @type {string} */ n) => (n === 'href' ? href : (attrs[n] ?? null)),
      hasAttribute: (/** @type {string} */ n) => n in attrs
    };
    const e = { target: { closest: () => a }, button: 0, preventDefault: vi.fn(), ...init };
    // a plain object stands in for the Element check below
    Object.setPrototypeOf(e.target, Element.prototype);
    return e;
  };
  it('opens an in-app link without a page load; leaves external and modified clicks', () => {
    const open = vi.fn();
    const a = click('/naddr1x');
    onLinkClick(/** @type {any} */ (a), open);
    expect(open).toHaveBeenCalledWith('/naddr1x');
    expect(a.preventDefault).toHaveBeenCalled();
    onLinkClick(/** @type {any} */ (click('https://src.org/a')), open);
    onLinkClick(/** @type {any} */ (click('//evil.example')), open);
    onLinkClick(/** @type {any} */ (click('/x', { ctrlKey: true })), open);
    onLinkClick(/** @type {any} */ (click('/x', { button: 1 })), open);
    onLinkClick(/** @type {any} */ (click('/x', {}, { target: '_blank' })), open);
    onLinkClick(/** @type {any} */ (click('/x', {}, { download: '' })), open);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('hostile and structural inputs, safe and exported alike', () => {
  const kit = linkKit(turns, ORIGIN);
  /** @param {string} md */
  const both = (md) => [kit.safe(md), kit.exported(md)];

  it.each(
    H([
      ['escaped backtick before a link', '\\`[x](https://evil.example)`'],
      ['definition in a quote', '> [x]: https://evil.example\n\n[x]'],
      ['definition in a list', '- [x]: https://evil.example\n\n[x]'],
      ['destination on the next line', '[x]:\n  https://evil.example\n\n[x]'],
      ['angle destination on the next line', '[x][y]\n\n[y]:\n<https://evil.example>'],
      ['two nested parentheses', '[x](https://evil.example/a(b(c)))'],
      ['image in rejected link text', '[![a](https://evil.example/p.png)](https://evil.example)'],
      ['image in kept link text', `[![a](https://evil.example/p.png)](${NADDR})`],
      ['tracking pixel alone', '![a](https://evil.example/p.png)'],
      ['image in a quote', '> ![a](https://evil.example/p.png)']
    ])
  )('%s: nothing of evil survives', (_n, md) => {
    for (const out of both(md)) expect(out).not.toMatch(/evil/);
  });

  it('a kept link around an image keeps the link and drops the image', () => {
    for (const out of both(`[![a](https://evil.example/p.png)](${NADDR})`))
      expect(out).toMatch(/^\[a\]\(.*naddr1/);
  });

  it('a kept link whose text looks like another URL or domain becomes plain text', () => {
    for (const out of both(`[https://bank.example](${NADDR})`))
      expect(out).toBe('https://bank.example');
    for (const out of both(`[bank.example/login](${NADDR})`))
      expect(out).toBe('bank.example/login');
    for (const out of both('[src.org/a](https://src.org/a)')) expect(out).toContain('](');
  });

  it('prose with < survives', () => {
    for (const md of ['1 < 2 and 3 > 2', 'a <3 b']) {
      for (const out of both(md)) expect(out).toBe(md);
    }
  });

  it('only attribute-free formatting tags stay, the others are escaped to text', () => {
    for (const out of both('x <a href="javascript:1">k</a> <img src=x onerror=y> y <b>fett</b>'))
      expect(out).toBe(
        'x &lt;a href="javascript:1">k&lt;/a> &lt;img src=x onerror=y> y <b>fett</b>'
      );
  });

  it('autolinks, bare urls and e-mail stay visible text', () => {
    for (const out of both('<https://evil.example> https://evil.example <me@evil.example>')) {
      expect(out).not.toContain('<');
      expect(out).toContain('evil.example');
    }
  });

  const SAMPLES = {
    'allowed links only': `# T\n\nSiehe [A](${NADDR}) und [S](https://src.org/a) und *[S](https://src.org/a)*.\n\n- Punkt [A](${NADDR})\n  weiter\n- zwei\n\n> Zitat [S](https://src.org/a)\n`,
    'code with link syntax':
      'Text `[a](https://evil.example)` und\n\n```\n[b](https://evil.example)\n```\n\n    [c](https://evil.example)\n',
    table: '| A | B |\n|---|---|\n| [A](/naddr1event) | `[x](https://evil.example)` |\n| x | y |\n',
    liascript:
      '<!--\nlanguage: de\nauthor:\nnarrator: German Female\n-->\n\n# Kurs\n\n## Frage\n\n- [( )] falsch\n- [(X)] richtig\n\n- [[X]] a\n- [[ ]] b\n\nLücke: [[Antwort]] und [[x]]\n\n    --{{1}}--\nText ende [A](/naddr1event)\n'
  };
  it.each(Object.entries(SAMPLES))('round-trips byte for byte: %s', (_n, md) => {
    expect(kit.safe(md)).toBe(md);
    expect(kit.exported(md)).toBe(
      md
        .replace(/\]\((\/naddr)/g, `](${ORIGIN}$1`)
        .replace(/\| \[A\]\(\/naddr1event\)/, `| [A](${ORIGIN}/naddr1event)`)
    );
  });

  it('a 20000-bracket line does not blow up', () => {
    const t = performance.now();
    kit.safe('['.repeat(20000));
    kit.exported('['.repeat(20000));
    expect(performance.now() - t).toBeLessThan(3000);
  });
});

describe('fallback and raw html', () => {
  const kit = linkKit(turns, ORIGIN);
  const E = 'https://evil.example';
  /** @param {string} md */
  const both = (md) => [kit.safe(md), kit.exported(md)];

  it.each(
    H([
      ['multi-line link in a quote, definition apart', `> [x\n> y](${E})\n\n[x]:\n  ${E}\n\n[x]`],
      ['multi-line link and image in a quote', `> [x\n> y](${E}) [![a](${E}/p.png)](${E})`]
    ])
  )('%s: no link, image or definition can form', (_n, md) => {
    for (const out of both(md)) {
      const html = renderMarkdown(out);
      expect(html).not.toMatch(/<a |<img/);
      expect(html).not.toContain(`href="${E}`);
      /** @type {string[]} */
      const kinds = [];
      new Marked({ breaks: true, gfm: true }).walkTokens(
        new Marked({ breaks: true, gfm: true }).lexer(out),
        (t) => {
          if (['link', 'image', 'def'].includes(t.type)) kinds.push(t.type);
        }
      );
      expect(kinds).toEqual([]);
    }
  });

  it('a doubled backslash before a bracket does not escape it', () => {
    const out = kit.safe(`> [x\n> y](${E}) \\[z](${E})`);
    expect(out).not.toMatch(/(?<!\\)(?:\\\\)*\[(?!\\)/);
  });

  it('tags without attributes stay, a plain comment goes', () => {
    for (const out of both('<!-- c --> <b>fett</b> <br>')) expect(out).toBe(' <b>fett</b> <br>');
  });

  it('text that merely contains a different URL or domain makes the link plain text', () => {
    for (const out of both(`[Bank: https://bank.example](${NADDR})`))
      expect(out).toBe('Bank: https://bank.example');
    for (const out of both('[Siehe src.org dort](https://src.org/a)')) expect(out).toContain('](');
    for (const out of both('[z.B. Brüche](https://src.org/a)')) expect(out).toContain('](');
  });
});

describe('html allowlist', () => {
  const kit = linkKit(turns, ORIGIN);
  const E = 'https://evil.example';
  /** @param {string} md */
  const both = (md) => [kit.safe(md), kit.exported(md)];
  const tagsOf = (/** @type {string} */ out) =>
    out.replace(/<!--(?:-?>|[\s\S]*?--!?>)/g, '').match(/<[a-z/][^>]*>?/gi) ?? [];

  it.each(
    H([
      `<iframe/src=${E}>`,
      `<img/src=${E}>`,
      `<a"href=${E}>x</a>`,
      `<style>body{background:url(${E}/p.png)}</style>`,
      `<script>fetch('${E}')</script>`,
      `<base href=${E}>`,
      `<object data=${E}>`,
      `<embed src=${E}>`,
      `<link rel=stylesheet href=${E}>`,
      `<meta http-equiv=refresh content="0;url=${E}">`,
      `<svg><image href=${E} /></svg>`,
      `<!-- x --><iframe/src=${E}>`,
      `<!--><img src=${E}>`,
      `<!-- a --!><img src=${E}>`,
      `<img src=${E}`
    ])
  )('%s: no tag of the output carries evil', (md) => {
    for (const out of both(md)) expect(tagsOf(out).join('')).not.toMatch(/evil/);
  });

  it('plain formatting tags survive', () => {
    for (const md of ['<details><summary>x</summary>y</details>', '<b>x</b>', '<br>']) {
      for (const out of both(md)) expect(out).toBe(md);
    }
  });
});

describe('one final html pass', () => {
  const kit = linkKit(turns, ORIGIN);
  const E = 'https://evil.example';
  const PLAIN =
    'b i em strong u s sub sup br hr p div span details summary table thead tbody tr td th ul ol li code pre kbd mark small blockquote h1 h2 h3 h4 h5 h6 section'.split(
      ' '
    );
  const COMMENT = /<!--(?!-?>)(?:(?!--!>)[\s\S])*?-->/g;
  /** @param {string} md */
  const both = (md) => [kit.safe(md), kit.exported(md)];
  /** The one assertion: outside allowlisted tags and complete comments no `<` opens anything. @param {string} out */
  const inert = (out) => {
    const rest = out
      .replace(COMMENT, '')
      .replace(/<\/?([a-z][a-z0-9]*)\s*\/?>/gi, (m, n) =>
        PLAIN.includes(n.toLowerCase()) ? '' : m
      );
    expect(rest).not.toMatch(/<[a-z/!?]/i);
    const html = new Marked({ breaks: true, gfm: true }).parse(out, { async: false });
    const names = [...html.replace(COMMENT, '').matchAll(/<\/?([a-z][a-z0-9]*)/gi)].map((m) =>
      m[1].toLowerCase()
    );
    for (const n of names)
      expect(
        [...PLAIN, 'a', 'p', 'em', 'strong', 'del', 'code', 'pre', 'br', 'hr'].includes(n),
        n
      ).toBe(true);
  };

  it.each(
    H([
      `![<iframe/src=${E}>](x)`,
      `![<iframe src=${E}></iframe>](x)`,
      `![a <img/src=${E}/p.png> b](x)`,
      `[a\\]<iframe/src=${E}>](${E})`,
      `<if<x y>rame src=${E}>`,
      '<scr<script>ipt>alert(1)</script>',
      `<<b>iframe src=${E}>`,
      `<ifr<b>ame src=${E}>`,
      `<iframe\n*x*\nsrc=${E}>`,
      `<iframe *x* src=${E}>`,
      `<!--> <iframe src=${E}>`,
      `<!---> <iframe src=${E}>`,
      `<!-- a --!> <iframe src=${E}> -->`,
      `<![CDATA[ <iframe src=${E}> ]]>`,
      `<?php x ?><iframe src=${E}>`,
      '<!DOCTYPE html><script>1</script>',
      `<!-- open <iframe src=${E}>`,
      `<style>body{background:url(${E})}</style>`,
      `<script>fetch('${E}')</script>`
    ])
  )('%s', (md) => {
    for (const out of both(md)) inert(out);
  });

  it('is idempotent', () => {
    for (const md of [
      `<if<x y>rame src=${E}>`,
      'n<a then b>c',
      '<!-- c -->\n\n<b>x</b>',
      '`<iframe>` und <i>x</i>',
      `![<iframe/src=${E}>](x)`
    ])
      for (const out of both(md)) {
        expect(kit.safe(out)).toBe(out);
      }
  });

  it('prose with a tag-like word keeps its text', () => {
    for (const out of both('n<a then b>c')) expect(out).toBe('n&lt;a then b>c');
  });

  it('code stays as written', () => {
    for (const md of [
      `\`\`\`html\n<iframe src=${E}>\n\`\`\`\n`,
      `Beispiel \`<iframe src=${E}>\` hier`,
      `    <iframe src=${E}>\n`,
      `> \`<img src=${E}>\`\n`
    ])
      for (const out of both(md)) expect(out).toBe(md);
  });

  it('formatting tags and comments stay', () => {
    for (const md of [
      '<details><summary>x</summary>y</details>',
      '<b>x</b>',
      '<!--\nlanguage: de\n-->\n\n# T'
    ])
      for (const out of both(md)) expect(out).toBe(md);
  });
});

describe('fix round 4: canonical links, comment rule, linear time', () => {
  const E = 'https://evil.example';
  const extra = [
    {
      role: 'assistant',
      text: '',
      tier: 1,
      items: [
        { type: 'resource', id: 'w', title: 'W', href: 'https://de.wikipedia.org/wiki/A_(B)' },
        { type: 'resource', id: 'q', title: 'Q', href: `https://q.org/it's"x` }
      ]
    }
  ];
  const kit = linkKit([...turns, ...extra], ORIGIN);
  /** @param {string} md */
  const both = (md) => [kit.safe(md), kit.exported(md)];
  const iframe = `<iframe src=${E}>`;

  it.each(
    H([
      ['reference label carrying a tag', `[a][${iframe}]\n\n[${iframe}]: ${NADDR}`],
      ['title carrying a tag', `[x](${NADDR} "${iframe}")`],
      ['angle destination', `[x](<${NADDR}>)`],
      ['angle destination with a space', '[x](<https://src.org/a b>)'],
      ['collapsed reference, rejected', `[x][]\n\n[x]: ${E}`],
      ['shortcut reference, rejected', `[x]\n\n[x]: ${E}`],
      ['definition in a blockquote', `> [x]: ${NADDR} "${iframe}"\n\n[y][x]`],
      ['definition in a list', `- [x]: ${NADDR} "${iframe}"\n\n[y][x]`],
      ['backtick hidden in a tag attribute', `<a title="\`">x \`${iframe}\``],
      ['script block before indented code', `<script>x</script>\n    ${iframe}`],
      ['comment before a link becomes an image', `!<!-- c -->[x](${NADDR})`]
    ])
  )('A: %s', (_n, md) => {
    for (const out of both(md)) {
      // escaped tag text may stay visible; no live tag, title, definition or reference does
      expect(out).not.toMatch(/<iframe|\]:|\]\(<|\]\[/);
      expect(out.replace(/&lt;[^\n]*/g, '')).not.toContain('"');
    }
  });

  it('A: kept links come out in the one canonical form', () => {
    expect(kit.safe(`[a][r]\n\n[r]: ${NADDR} "t"`).trim()).toBe(`[a](${NADDR})`);
    expect(kit.safe(`[x](${NADDR} "${iframe}")`)).toBe(`[x](${NADDR})`);
    expect(kit.safe(`[x](<${NADDR}>)`)).toBe(`[x](${NADDR})`);
    expect(kit.safe('[x](<https://src.org/a b>)')).toBe('x');
    expect(kit.safe(`[x][]\n\n[x]: ${NADDR}`).trim()).toBe(`[x](${NADDR})`);
    expect(kit.safe(`[x]\n\n[x]: ${NADDR}`).trim()).toBe(`[x](${NADDR})`);
    expect(kit.safe(`[x][]\n\n[x]: ${E}`).trim()).toBe('x');
    expect(kit.safe(`[x]\n\n[x]: ${E}`).trim()).toBe('x');
    expect(kit.safe(`> [x]: ${NADDR}\n\n[y][x]`)).toContain(`[y](${NADDR})`);
    expect(kit.safe(`- [x]: ${NADDR}\n\n[y][x]`)).toContain(`[y](${NADDR})`);
    expect(kit.exported(`[a][r]\n\n[r]: ${NADDR}`).trim()).toBe(`[a](${ORIGIN}${NADDR})`);
  });

  it('A: an allowed url with parentheses or quotes cannot break out of the link', () => {
    expect(kit.safe('[w](https://de.wikipedia.org/wiki/A_(B))')).toBe(
      '[w](https://de.wikipedia.org/wiki/A_%28B%29)'
    );
    expect(kit.safe(`[q](<https://q.org/it's"x>)`)).toBe('[q](https://q.org/it%27s%22x)');
    for (const md of [
      '[w](https://de.wikipedia.org/wiki/A_%28B%29)',
      '[q](https://q.org/it%27s%22x)'
    ])
      expect(kit.safe(md)).toBe(md);
  });

  const HEADER =
    '<!--\nauthor:\nversion: 1.0.0\nlanguage: de\nnarrator: Deutsch Female\ncomment: Ein Kurs über Brüche.\n-->';

  it.each(
    H([
      [
        'directives in a header',
        '<!--\nauthor: Termi\nscript: https://evil.example/x.js\nlink: https://evil.example/s.css\nimport: https://evil.example/t.md\n-->\n\n# Kurs'
      ],
      ['attribute comment before a paragraph', `<!-- style="background:url(${E})" -->\nText`],
      [
        'macro definition in a header',
        '<!--\nlanguage: de\n@onload\nfetch("https://evil.example")\n@end\n-->'
      ],
      [
        'continuation of a directive',
        '<!--\nlanguage: de\nscript:\n  https://evil.example/x.js\n-->'
      ],
      ['comment ended early, then a tag', `<!-- a --> ${iframe} -->`],
      ['header value smuggling an attribute', `<!--\nauthor: x style="background:url(${E})"\n-->`],
      [
        'directive behind a unicode line separator',
        '<!--\nauthor: A\u2028script: https://evil.example/x.js\n-->'
      ],
      ['comment ended by --!>', `<!-- author: x --!> ${iframe} -->`]
    ])
  )('B: %s', (_n, md) => {
    for (const out of both(md)) {
      expect(out).not.toMatch(/<iframe/);
      expect(out.replace(/&lt;[^\n]*/g, '')).not.toMatch(/evil|style=/);
    }
  });

  it('B: only safe header lines survive; everything else that is a comment goes', () => {
    for (const out of both(
      '<!--\nauthor: Termi\nscript: https://evil.example/x.js\nlink: https://evil.example/s.css\nimport: https://evil.example/t.md\n-->\n\n# Kurs'
    ))
      expect(out).toBe('<!--\nauthor: Termi\n-->\n\n# Kurs');
    for (const out of both(`<!-- style="background:url(${E})" -->\nText`))
      expect(out).toBe('\nText');
    for (const out of both('A <!-- Notiz --> B')) expect(out).toBe('A  B');
    for (const out of both(`<!-- a --> ${iframe} -->`))
      expect(out).toBe(` &lt;iframe src=${E}> -->`);
  });

  it("B: a normal Termi course header and Termi's part markers round-trip", () => {
    for (const md of [
      `${HEADER}\n\n# Brüche\n\n## Frage\n\n- [( )] falsch\n- [(X)] richtig\n`,
      '<!-- termi:part lesson 2 -->\n# Stunde 2\n\nText',
      '<!-- termi:part overview -->\n# Überblick',
      '<!-- author: Termi -->\n# T'
    ])
      for (const out of both(md)) expect(out).toBe(md);
    // a marker that only resembles Termi's goes
    for (const out of both('<!-- termi:part evil -->x')) expect(out).toBe('x');
  });

  it.each([
    ['`<'.repeat(50000)],
    ['<b>'.repeat(33000)],
    ['['.repeat(100000)],
    ['<!--'.repeat(25000)],
    ['<a'.repeat(50000)]
  ])('C: %#. a 100k pathological input stays fast', (md) => {
    const t = performance.now();
    kit.safe(md);
    kit.exported(md);
    // marked's own lexer takes ~200 ms of this on a 100k input; the rest is linear
    expect(performance.now() - t).toBeLessThan(1500);
  });

  it('round-trips a whole allowed document byte for byte, and safe is idempotent', () => {
    const doc = `${HEADER}\n\n# Brüche\n\nSiehe [A](${NADDR}) und [S](https://src.org/a).\n\n| A | B |\n|---|---|\n| [E](/naddr1event) | \`[x](${E})\` |\n\n\`\`\`html\n${iframe}\n[b](${E})\n\`\`\`\n\nCode \`${iframe}\` und \`[c](${E})\`.\n\n- [[X]] a\n- [[ ]] b\n\n- [( )] falsch\n- [(X)] richtig\n\nLücke: [[Antwort]] von @author am @date, Abschnitt @section.\n`;
    expect(kit.safe(doc)).toBe(doc);
    expect(kit.exported(doc)).toBe(
      doc
        .replace(`[A](${NADDR})`, `[A](${ORIGIN}${NADDR})`)
        .replace('[E](/naddr1event)', `[E](${ORIGIN}/naddr1event)`)
    );
    for (const md of [doc, ...HOSTILE]) {
      expect(kit.safe(kit.safe(md))).toBe(kit.safe(md));
      expect(kit.exported(kit.exported(md))).toBe(kit.exported(md));
    }
  });
});

describe('every hostile input, rendered by a bare marked with no sanitiser', () => {
  const kit = linkKit(turns, ORIGIN);
  const PLAIN =
    'b i em strong u s sub sup br hr p div span details summary table thead tbody tr td th ul ol li code pre kbd mark small blockquote h1 h2 h3 h4 h5 h6 section'.split(
      ' '
    );
  const ELEMENTS = new Set([...PLAIN, 'a', 'del', 'input']);
  /** @type {Record<string, string[]>} */
  const ATTRS = {
    a: ['href'],
    ol: ['start'],
    input: ['checked', 'disabled', 'type'],
    th: ['align'],
    td: ['align'],
    code: ['class']
  };
  const SAFE_KEY =
    /^\s*(?:author|email|version|language|narrator|comment|mode|dark|date|title|tags)\s*:[^<=]*$/;
  /** Termi's part marker, or a header of safe `key: value` lines only. @param {string} data */
  const commentOk = (data) =>
    /^\s*termi:part\s+(?:overview|lesson|worksheets|summary|module|sources)(?:\s+\d{1,3})?\s*$/.test(
      data
    ) ||
    (data.split('\n').every((l) => !l.trim() || SAFE_KEY.test(l)) &&
      SAFE_KEY.test(data.trim().split('\n')[0]));

  /** @param {string} out */
  const assertInert = (out) => {
    const tpl = document.createElement('template');
    tpl.innerHTML = /** @type {string} */ (
      new Marked({ breaks: true, gfm: true }).parse(out, { async: false })
    );
    for (const el of tpl.content.querySelectorAll('*')) {
      const name = el.localName;
      expect(ELEMENTS.has(name), `<${name}> from ${JSON.stringify(out)}`).toBe(true);
      for (const a of el.getAttributeNames())
        expect(ATTRS[name] ?? [], `${name}[${a}] from ${JSON.stringify(out)}`).toContain(a);
      if (name === 'a') {
        const href = el.getAttribute('href') ?? '';
        const text = el.textContent ?? '';
        // bare urls, www. and e-mail stay visible text (round 1 ruling): the target is what the reader sees
        const visible = [text, `mailto:${text}`, `http://${text}`].includes(decodeURI(href));
        expect(kit.ok(href) || visible, `href ${href} from ${JSON.stringify(out)}`).toBe(true);
      }
    }
    const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_COMMENT);
    for (let c = walker.nextNode(); c; c = walker.nextNode())
      expect(commentOk(/** @type {Comment} */ (c).data), `comment ${c.textContent}`).toBe(true);
  };

  it('collected some', () => expect(HOSTILE.length).toBeGreaterThan(60));
  it.each(HOSTILE.map((md) => [md]))('%s', (md) => {
    assertInert(kit.safe(md));
    assertInert(kit.exported(md));
  });
});
