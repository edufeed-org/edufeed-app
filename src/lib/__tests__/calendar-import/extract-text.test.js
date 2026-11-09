/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractText } from '$lib/helpers/calendar-import/extract-text.js';

const fixturesDir = fileURLToPath(new URL('../fixtures/calendar-import/', import.meta.url));

/** @param {string} name @param {string} [type] */
function fixtureFile(name, type = '') {
  const buf = readFileSync(fixturesDir + name);
  return new File([buf], name, type ? { type } : undefined);
}

describe('extractText', () => {
  it('reads a CSV: BOM stripped, text kind, all lines present', async () => {
    const { text, kind, truncated } = await extractText(fixtureFile('outlook-en.csv'));
    expect(kind).toBe('text');
    expect(truncated).toBe(false);
    expect(text.startsWith('Subject,')).toBe(true);
    expect(text.split(/\r\n|\n/).filter(Boolean)).toHaveLength(57);
  });

  it('reads a plain txt file', async () => {
    const { text, kind } = await extractText(fixtureFile('termine.txt'));
    expect(kind).toBe('text');
    expect(text).toBe(readFileSync(fixturesDir + 'termine.txt', 'utf8'));
  });

  it('strips tags from an HTML file, dropping scripts', async () => {
    const html = '<html><body><script>evil()</script><p>Hello</p><p>World</p></body></html>';
    const file = new File([html], 'note.html', { type: 'text/html' });
    const { text, kind } = await extractText(file);
    expect(kind).toBe('text');
    expect(text).not.toContain('evil()');
    expect(text).not.toContain('<p>');
    expect(text).toContain('Hello');
    expect(text).toContain('World');
  });

  it('routes a PDF through the injected loadPdf and joins pages', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'doc.pdf');
    const loadPdf = async () => ({ pages: ['Page one', 'Page two'] });
    const { text, kind } = await extractText(file, { loadPdf });
    expect(kind).toBe('pdf');
    expect(text).toBe('Page one\n\nPage two');
  });

  it('truncates long text and reports truncated: true', async () => {
    const long = 'x'.repeat(70_000);
    const file = new File([long], 'big.txt');
    const { text, truncated } = await extractText(file);
    expect(text).toHaveLength(60_000);
    expect(truncated).toBe(true);
  });

  it('returns empty text for unreadable binary data', async () => {
    const bytes = new Uint8Array(200);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) % 256;
    // Avoid an accidental PK\x03\x04 zip signature at the start.
    bytes[0] = 0xff;
    const file = new File([bytes], 'x.bin');
    const { text } = await extractText(file);
    expect(text).toBe('');
  });

  it('reads termine.docx as a zip', async () => {
    const { text, kind } = await extractText(fixtureFile('termine.docx'));
    expect(kind).toBe('zip');
    const lines = text.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('10.09.2026');
  });

  it('falls back to plain text when a PK-sniffed file with no Office name/MIME is not really a zip', async () => {
    const bytes = new Uint8Array([
      ...[0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0],
      ...new TextEncoder().encode('hello from a weird file')
    ]);
    const file = new File([bytes], 'mystery.unknown');
    const { text, kind } = await extractText(file);
    expect(kind).toBe('text');
    expect(text).toContain('hello from a weird file');
  });

  it('resolves empty text (never rejects) for a corrupt file with a real Office extension', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
    const file = new File([bytes], 'broken.docx');
    const { text, kind } = await extractText(file);
    expect(kind).toBe('zip');
    expect(text).toBe('');
  });
});
