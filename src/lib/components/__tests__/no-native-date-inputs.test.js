/**
 * Guard: no native `<input type="date">` anywhere in the app.
 *
 * Native date inputs render in the browser's locale (US users see
 * MM/DD/YYYY), but the app must show German DD.MM.YYYY everywhere
 * (issue #33). EuropeanDateInput wraps a masked text field + calendar
 * popup and binds the same ISO YYYY-MM-DD string, so it is a drop-in
 * replacement for every native date input.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** @param {string} dir @returns {string[]} */
function svelteFiles(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.svelte'))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Drop HTML and JS block comments so documentation mentions don't match. @param {string} source */
function withoutComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('native date inputs', () => {
  it('are not used anywhere (use EuropeanDateInput instead)', () => {
    const offenders = svelteFiles('src').filter((file) =>
      /type=["']date["']/.test(withoutComments(readFileSync(file, 'utf8')))
    );
    expect(offenders).toEqual([]);
  });
});
