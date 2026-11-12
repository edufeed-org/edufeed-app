/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { Marked } from 'marked';
import { renderMarkdown } from '$lib/helpers/markdown.js';
import {
  allowedLinks,
  safeLinks,
  absoluteLinks,
  linkPredicate,
  linkKit,
  onLinkClick
} from '../links.js';

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
    expect(safe('[S](https://src.org/a "Titel")')).toBe('[S](https://src.org/a "Titel")');
    expect(safe('[P](<https://pass.org/p?x=1&y=2>)')).toBe('[P](<https://pass.org/p?x=1&y=2>)');
  });
  it.each([
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
  ])('%s -> its text', (_n, md) => {
    const out = safe(md);
    expect(out).not.toMatch(/\]\(|evil|javascript|data:|vbscript/i);
    expect(out).toContain('t');
  });
  it('reference-style: a bad definition is dropped and its uses become text', () => {
    const out = safe(
      'See [Foo][b] and [b] and [x][].\n\n[b]: https://evil.example\n[x]: https://src.org/a'
    );
    expect(out).not.toContain('evil');
    expect(out).toContain('See Foo and b and [x][].');
    expect(out).toContain('[x]: https://src.org/a');
  });
  it('autolinks become their visible text (the renderer decides about bare urls)', () => {
    expect(safe('<https://src.org/a>')).toBe('https://src.org/a');
    expect(safe('<https://evil.example>')).not.toContain('<');
    expect(safe('<javascript:alert(1)>')).not.toContain('<');
    expect(safe('<me@evil.example>')).not.toContain('<');
  });
  it('images become their alt text, raw <a>/<img> tags go', () => {
    expect(safe('![Bild](https://src.org/a)')).toBe('Bild');
    expect(safe('x <a href="javascript:1" onclick="x">Klick</a> <img src=x onerror=y> y')).toBe(
      'x Klick  y'
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
      '[w](https://de.wikipedia.org/wiki/A_(B))'
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

describe('absoluteLinks', () => {
  it('turns in-app targets into absolute ones, leaves the rest', () => {
    expect(
      absoluteLinks(`[A](${NADDR}) [S](https://src.org/a) [x][r]\n\n[r]: /c/npub1abc`, ORIGIN)
    ).toBe(`[A](${ORIGIN}${NADDR}) [S](https://src.org/a) [x][r]\n\n[r]: ${ORIGIN}/c/npub1abc`);
  });
  it('is idempotent and skips code', () => {
    const md = `[A](${ORIGIN}${NADDR}) \`[a](/x)\``;
    expect(absoluteLinks(md, ORIGIN)).toBe(md);
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
  const click = (href, init = {}) => {
    const a = { getAttribute: () => href };
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
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('hostile and structural inputs, safe and exported alike', () => {
  const kit = linkKit(turns, ORIGIN);
  /** @param {string} md */
  const both = (md) => [kit.safe(md), kit.exported(md)];

  it.each([
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
  ])('%s: nothing of evil survives', (_n, md) => {
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
    for (const md of ['1 < 2 and 3 > 2', 'n<a then b>c', 'if a<b then c>d']) {
      for (const out of both(md)) expect(out).toBe(md);
    }
  });

  it('only html tags that can navigate or fetch are removed', () => {
    for (const out of both('x <a href="javascript:1">k</a> <img src=x onerror=y> y <b>fett</b>'))
      expect(out).toBe('x k  y <b>fett</b>');
  });

  it('autolinks, bare urls and e-mail stay visible text', () => {
    for (const out of both('<https://evil.example> https://evil.example <me@evil.example>')) {
      expect(out).not.toContain('<');
      expect(out).toContain('evil.example');
    }
  });

  const SAMPLES = {
    'allowed links only': `# T\n\nSiehe [A](${NADDR}) und [S](https://src.org/a "Titel") und *[S](https://src.org/a)*.\n\n- Punkt [A](${NADDR})\n  weiter\n- zwei\n\n> Zitat [S](https://src.org/a)\n`,
    'code with link syntax':
      'Text `[a](https://evil.example)` und\n\n```\n[b](https://evil.example)\n```\n\n    [c](https://evil.example)\n',
    table: '| A | B |\n|---|---|\n| [A](/naddr1event) | `[x](https://evil.example)` |\n| x | y |\n',
    liascript:
      '<!--\nlanguage: de\nauthor:\nnarrator: German Female\n-->\n\n# Kurs\n\n## Frage\n\n- [( )] falsch\n- [(X)] richtig\n\n- [[X]] a\n- [[ ]] b\n\nLücke: [[Antwort]] und [[x]]\n\n    --{{1}}--\nText <!-- c --> ende [A](/naddr1event)\n'
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

  it.each([
    ['multi-line link in a quote, definition apart', `> [x\n> y](${E})\n\n[x]:\n  ${E}\n\n[x]`],
    ['multi-line link and image in a quote', `> [x\n> y](${E}) [![a](${E}/p.png)](${E})`]
  ])('%s: no link, image or definition can form', (_n, md) => {
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

  it.each([
    `<iframe src=${E}></iframe>`,
    `<video poster=${E}/p.png></video>`,
    `<source srcset="${E}/a.png 1x">`,
    `<image href=${E}/p.svg>`,
    `<area href=${E}>`,
    `<p style="background:url(${E})">text</p>`,
    `<object data=${E}></object>`,
    `<form action=${E}>x</form>`,
    `x <span style="color:red">t</span> y`
  ])('raw html %s carries no external reference out', (md) => {
    for (const out of both(md)) expect(out).not.toMatch(/evil|style=/);
  });

  it('tags without such attributes and comments stay', () => {
    for (const out of both('<!-- c --> <b class="k">fett</b> <br>'))
      expect(out).toBe('<!-- c --> <b class="k">fett</b> <br>');
  });

  it('text that merely contains a different URL or domain makes the link plain text', () => {
    for (const out of both(`[Bank: https://bank.example](${NADDR})`))
      expect(out).toBe('Bank: https://bank.example');
    for (const out of both('[Siehe src.org dort](https://src.org/a)')) expect(out).toContain('](');
    for (const out of both('[z.B. Brüche](https://src.org/a)')) expect(out).toContain('](');
  });
});
