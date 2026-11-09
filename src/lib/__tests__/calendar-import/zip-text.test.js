/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readZipEntries, zipToText } from '$lib/helpers/calendar-import/zip-text.js';

const fixturesDir = fileURLToPath(new URL('../fixtures/calendar-import/', import.meta.url));

/** @param {string} name */
function readFixtureBytes(name) {
  return new Uint8Array(readFileSync(fixturesDir + name));
}

describe('readZipEntries / zipToText', () => {
  it('reads termine.xlsx into tab-separated rows via shared + inline strings', async () => {
    const entries = await readZipEntries(readFixtureBytes('termine.xlsx'));
    const text = zipToText(entries);
    const lines = text.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('Betreff\tBeginn\tEnde\tOrt');
    expect(lines[1].startsWith('Teamsitzung\t2026-09-10T09:00')).toBe(true);
  });

  it('reads termine.docx into one line per paragraph', async () => {
    const entries = await readZipEntries(readFixtureBytes('termine.docx'));
    const text = zipToText(entries);
    const lines = text.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('10.09.2026');
  });

  it('rejects a non-zip buffer', async () => {
    const bytes = new TextEncoder().encode('not a zip file at all');
    await expect(readZipEntries(bytes)).rejects.toThrow();
  });
});
