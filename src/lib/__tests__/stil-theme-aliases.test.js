/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Drift guard for the env-gated `stil` theme.
 *
 * The editorial aliases (`--c-*`, `--font-*`) are derived once on `:root`
 * from the active DaisyUI tokens. That derivation encodes the edufeed
 * editorial look (teal hero, red band, olive from success, Outfit + Caveat).
 * The `stil` deployment restates every alias in its own
 * `[data-theme='stil']` block so a new alias can never silently fall back
 * to edufeed values on the client's deployment.
 */

const css = readFileSync(resolve(__dirname, '../../app.css'), 'utf8');

/**
 * Return the concatenated bodies of every `selector { ... }` block
 * (brace-balanced), or null when the selector never occurs.
 * @param {string} selector
 * @returns {string | null}
 */
function blockBody(selector) {
  let body = null;
  let from = 0;
  for (;;) {
    const start = css.indexOf(selector, from);
    if (start === -1) return body;
    const open = css.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) {
        body = (body ?? '') + css.slice(open + 1, i);
        from = i;
        break;
      }
    }
    if (from <= start) return body;
  }
}

/**
 * Custom property names declared in a block body.
 * @param {string} body
 * @returns {Set<string>}
 */
function declaredProps(body) {
  return new Set([...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

// Shared across every theme by design; not part of the palette.
const THEME_NEUTRAL = new Set(['--c-scrim']);

describe('stil theme editorial aliases', () => {
  const rootBody = blockBody(':root {');
  const stilBody = blockBody("[data-theme='stil'] {");

  it('has a [data-theme=stil] override block', () => {
    expect(stilBody).not.toBeNull();
  });

  it('restates every --c-* and --font-* alias from :root', () => {
    expect(rootBody).not.toBeNull();
    const rootAliases = [...declaredProps(/** @type {string} */ (rootBody))].filter(
      (p) => (p.startsWith('--c-') || p.startsWith('--font-')) && !THEME_NEUTRAL.has(p)
    );
    expect(rootAliases.length).toBeGreaterThan(10);
    const stilProps = declaredProps(stilBody ?? '');
    const missing = rootAliases.filter((p) => !stilProps.has(p));
    expect(missing).toEqual([]);
  });

  it('uses the self-hosted Open Sans face for every font alias', () => {
    const fonts = [...(stilBody ?? '').matchAll(/(--font-[a-z-]+)\s*:\s*([^;]+);/g)];
    expect(fonts.map((m) => m[1]).sort()).toEqual([
      '--font-display',
      '--font-sans',
      '--font-script'
    ]);
    for (const [, , value] of fonts) expect(value).toContain("'Open Sans Variable'");
  });
});
