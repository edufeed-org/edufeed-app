/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
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
  it('autolinks: allowed stay, unknown and javascript become bare text', () => {
    expect(safe('<https://src.org/a>')).toBe('<https://src.org/a>');
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
