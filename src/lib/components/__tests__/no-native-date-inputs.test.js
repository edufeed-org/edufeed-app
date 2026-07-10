/**
 * Guard: no native `<input type="date">` or `<input type="time">`
 * anywhere in the app.
 *
 * Native date/time inputs render in the browser's locale (US users see
 * MM/DD/YYYY and a 12-hour clock), but the app must show German
 * DD.MM.YYYY / 24-hour HH:MM everywhere (issue #33). EuropeanDateInput
 * and EuropeanTimeInput are masked text fields binding the same value
 * shapes, so they are drop-in replacements.
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

describe('native date/time inputs', () => {
  it('are not used anywhere (use EuropeanDateInput / EuropeanTimeInput instead)', () => {
    const offenders = svelteFiles('src').filter((file) =>
      /type=["'](date|time)["']/.test(withoutComments(readFileSync(file, 'utf8')))
    );
    expect(offenders).toEqual([]);
  });
});
