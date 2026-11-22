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

/** @param {string} xml */
function entryOf(xml) {
  return new TextEncoder().encode(xml);
}

/**
 * Builds a minimal, valid ZIP (local headers + central directory + EOCD) so
 * readZipEntries' bomb-protection logic can be exercised without pulling in
 * a real zip/deflate library. `declaredSize` lets a test lie about the
 * uncompressed size the way a crafted zip bomb would.
 * @param {{ name: string, data: Uint8Array, method?: number, declaredSize?: number }[]} items
 */
function buildZip(items) {
  const encoder = new TextEncoder();
  /** @type {Uint8Array[]} */
  const localParts = [];
  /** @type {Uint8Array[]} */
  const centralParts = [];
  let offset = 0;

  for (const item of items) {
    const nameBytes = encoder.encode(item.name);
    const method = item.method ?? 0;
    const compressedSize = item.data.length;
    const uncompressedSize = item.declaredSize ?? item.data.length;
    const localHeaderOffset = offset;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, method, true);
    local.setUint32(18, compressedSize, true);
    local.setUint32(22, uncompressedSize, true);
    local.setUint16(26, nameBytes.length, true);
    localParts.push(new Uint8Array(local.buffer), nameBytes, item.data);
    offset += 30 + nameBytes.length + item.data.length;

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(10, method, true);
    central.setUint32(20, compressedSize, true);
    central.setUint32(24, uncompressedSize, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, localHeaderOffset, true);
    centralParts.push(new Uint8Array(central.buffer), nameBytes);
  }

  const centralDirOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, items.length, true);
  eocd.setUint16(10, items.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, centralDirOffset, true);

  const parts = [...localParts, ...centralParts, new Uint8Array(eocd.buffer)];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const part of parts) {
    result.set(part, pos);
    pos += part.length;
  }
  return result;
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

  it('turns a docx tab-stop definition and an actual tab run into one tab, not raw XML', () => {
    const paragraph =
      '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="2835"/></w:tabs></w:pPr>' +
      '<w:r><w:t>10.09.2026</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>Teamsitzung</w:t></w:r></w:p>';
    const entries = new Map([['word/document.xml', entryOf(paragraph)]]);
    expect(zipToText(entries)).toBe('10.09.2026\tTeamsitzung');
  });

  it("pads a sparse xlsx row using each cell's column letter", () => {
    const sheet =
      '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="C1"><v>3</v></c></row></sheetData></worksheet>';
    const entries = new Map([['xl/worksheets/sheet1.xml', entryOf(sheet)]]);
    expect(zipToText(entries)).toBe('1\t\t3');
  });

  it('turns ODF tabs/spans into plain text, stripping unrelated markup', () => {
    const content =
      '<text:p>Hello <text:span text:style-name="T1">World</text:span><text:tab/>x</text:p>';
    const entries = new Map([['content.xml', entryOf(content)]]);
    expect(zipToText(entries)).toBe('Hello World\tx');
  });

  it('never inflates an entry zipToText does not read, even if it is 1 MB', async () => {
    const bytes = buildZip([
      { name: 'content.xml', data: entryOf('<text:p>Hi</text:p>') },
      { name: 'Thumbnails/thumbnail.png', data: new Uint8Array(1_000_000) }
    ]);
    const entries = await readZipEntries(bytes);
    expect(entries.has('content.xml')).toBe(true);
    expect(entries.has('Thumbnails/thumbnail.png')).toBe(false);
  });

  it('rejects a relevant entry whose declared size exceeds the decompression cap', async () => {
    const bytes = buildZip([
      {
        name: 'content.xml',
        data: new Uint8Array(10), // never actually inflated — rejected on the declared size alone
        method: 8,
        declaredSize: 25 * 1024 * 1024
      }
    ]);
    await expect(readZipEntries(bytes)).rejects.toThrow(/too large/);
  });
});
