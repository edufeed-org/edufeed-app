/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  materialTypeFromMime,
  materialTypeFromFilename,
  formatMaterialSize,
  describeLinkedMaterials
} from '$lib/helpers/educational/linkedMaterials.js';

/** @param {string[][]} tags */
const ev = (tags) => tags;

describe('materialTypeFromMime', () => {
  it('maps the exact office and pdf mimes', () => {
    expect(materialTypeFromMime('application/pdf')).toBe('pdf');
    expect(
      materialTypeFromMime(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      )
    ).toBe('presentation');
    expect(materialTypeFromMime('application/vnd.oasis.opendocument.presentation')).toBe(
      'presentation'
    );
    expect(
      materialTypeFromMime('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    ).toBe('spreadsheet');
    expect(
      materialTypeFromMime(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
    ).toBe('document');
    expect(materialTypeFromMime('application/msword')).toBe('document');
    expect(materialTypeFromMime('application/zip')).toBe('archive');
  });

  it('maps by type prefix for media', () => {
    expect(materialTypeFromMime('image/png')).toBe('image');
    expect(materialTypeFromMime('image/svg+xml')).toBe('image');
    expect(materialTypeFromMime('video/mp4')).toBe('video');
    expect(materialTypeFromMime('audio/mpeg')).toBe('audio');
    expect(materialTypeFromMime('text/plain')).toBe('text');
  });

  it('ignores case and parameters', () => {
    expect(materialTypeFromMime('APPLICATION/PDF')).toBe('pdf');
    expect(materialTypeFromMime('text/plain; charset=utf-8')).toBe('text');
    expect(materialTypeFromMime('  image/jpeg  ')).toBe('image');
  });

  it('returns null for the generic and the unknown, so callers can fall back', () => {
    // The publish path defaults to octet-stream, so this must NOT read as a
    // known type — otherwise every unlabelled upload claims to be a binary.
    expect(materialTypeFromMime('application/octet-stream')).toBe(null);
    expect(materialTypeFromMime('application/x-made-up')).toBe(null);
    expect(materialTypeFromMime('')).toBe(null);
    expect(materialTypeFromMime(undefined)).toBe(null);
  });
});

describe('materialTypeFromFilename', () => {
  it('reads the extension off a filename or a full url', () => {
    expect(materialTypeFromFilename('handout.pdf')).toBe('pdf');
    expect(materialTypeFromFilename('https://x.example/files/handout.pdf')).toBe('pdf');
    expect(materialTypeFromFilename('deck.pptx')).toBe('presentation');
    expect(materialTypeFromFilename('sheet.ods')).toBe('spreadsheet');
    expect(materialTypeFromFilename('notes.odt')).toBe('document');
    expect(materialTypeFromFilename('bundle.tar.gz')).toBe('archive');
    expect(materialTypeFromFilename('clip.WEBM')).toBe('video');
  });

  it('is not fooled by an extension-looking query string or fragment', () => {
    expect(materialTypeFromFilename('https://x.example/download?file=report.pdf')).toBe(null);
    expect(materialTypeFromFilename('https://x.example/page#section.pdf')).toBe(null);
  });

  it('is not fooled by a dot in a directory name', () => {
    expect(materialTypeFromFilename('https://x.example/v1.2/download')).toBe(null);
  });

  it('returns null when there is nothing to go on', () => {
    expect(materialTypeFromFilename('https://x.example/materials')).toBe(null);
    expect(materialTypeFromFilename('')).toBe(null);
    expect(materialTypeFromFilename(undefined)).toBe(null);
  });
});

describe('formatMaterialSize', () => {
  it('formats bytes, KB, MB and GB', () => {
    expect(formatMaterialSize(512, 'en')).toBe('512 B');
    expect(formatMaterialSize(2048, 'en')).toBe('2 KB');
    expect(formatMaterialSize(1024 * 1024 * 2.4, 'en')).toBe('2.4 MB');
    expect(formatMaterialSize(1024 * 1024 * 1024 * 3, 'en')).toBe('3 GB');
  });

  it('uses the locale decimal separator', () => {
    expect(formatMaterialSize(1024 * 1024 * 2.4, 'de')).toBe('2,4 MB');
  });

  it('drops a trailing .0 rather than showing "2.0 MB"', () => {
    expect(formatMaterialSize(1024 * 1024 * 2, 'en')).toBe('2 MB');
  });

  it('returns null for absent, zero and nonsense sizes', () => {
    // 0 is what parseInt gives for a missing encoding:contentSize, so it must
    // read as "unknown" rather than as a real zero-byte file.
    expect(formatMaterialSize(0, 'en')).toBe(null);
    expect(formatMaterialSize(NaN, 'en')).toBe(null);
    expect(formatMaterialSize(-1, 'en')).toBe(null);
    expect(formatMaterialSize(undefined, 'en')).toBe(null);
  });
});

describe('describeLinkedMaterials', () => {
  it('counts uploads and external references together, as the badge always has', () => {
    const tags = ev([
      ['encoding:contentUrl', 'https://x.example/a.pdf'],
      ['r', 'https://elsewhere.example/page'],
      ['r', 'https://elsewhere.example/other']
    ]);
    expect(describeLinkedMaterials(tags).count).toBe(3);
  });

  it('describes a single upload from its mime and size', () => {
    const tags = ev([
      ['encoding:contentUrl', 'https://x.example/a'],
      ['encoding:encodingFormat', 'application/pdf'],
      ['encoding:contentSize', '2516582']
    ]);
    expect(describeLinkedMaterials(tags)).toEqual({
      count: 1,
      items: [{ source: 'upload', type: 'pdf', size: 2516582 }]
    });
  });

  it('falls back to the url extension when the mime is missing or generic', () => {
    const noMime = ev([['encoding:contentUrl', 'https://x.example/handout.pdf']]);
    expect(describeLinkedMaterials(noMime).items[0].type).toBe('pdf');

    const genericMime = ev([
      ['encoding:contentUrl', 'https://x.example/deck.pptx'],
      ['encoding:encodingFormat', 'application/octet-stream']
    ]);
    expect(describeLinkedMaterials(genericMime).items[0].type).toBe('presentation');
  });

  it('types an upload with no signal at all as a plain file', () => {
    const tags = ev([['encoding:contentUrl', 'https://x.example/download']]);
    expect(describeLinkedMaterials(tags).items[0]).toEqual({
      source: 'upload',
      type: 'file',
      size: null
    });
  });

  it('types an external reference from its extension, else as a link', () => {
    const tags = ev([
      ['r', 'https://elsewhere.example/handout.pdf'],
      ['r', 'https://elsewhere.example/lesson']
    ]);
    const { items } = describeLinkedMaterials(tags);
    expect(items).toEqual([
      { source: 'link', type: 'pdf', size: null },
      { source: 'link', type: 'link', size: null }
    ]);
  });

  // The pairing hazard the publish path documents (publicationTags.js:122-124):
  // getAMBEncodings aligns the three tag lists positionally, so a file missing
  // an optional field shifts every later index and mislabels a later file with
  // an earlier file's type.
  describe('positional pairing', () => {
    it('pairs by index when the lists line up', () => {
      const tags = ev([
        ['encoding:contentUrl', 'https://x.example/a'],
        ['encoding:contentUrl', 'https://x.example/b'],
        ['encoding:encodingFormat', 'application/pdf'],
        ['encoding:encodingFormat', 'image/png'],
        ['encoding:contentSize', '100'],
        ['encoding:contentSize', '200']
      ]);
      expect(describeLinkedMaterials(tags).items).toEqual([
        { source: 'upload', type: 'pdf', size: 100 },
        { source: 'upload', type: 'image', size: 200 }
      ]);
    });

    it('refuses to guess when the format list is short, rather than mislabelling', () => {
      // Two files, one format. Index 0 happens to be right and index 1 would
      // silently inherit nothing — but which file the lone format belongs to is
      // not recoverable, so neither may claim it. The url extension still may.
      const tags = ev([
        ['encoding:contentUrl', 'https://x.example/a'],
        ['encoding:contentUrl', 'https://x.example/b.png'],
        ['encoding:encodingFormat', 'application/pdf']
      ]);
      expect(describeLinkedMaterials(tags).items).toEqual([
        { source: 'upload', type: 'file', size: null },
        { source: 'upload', type: 'image', size: null }
      ]);
    });

    it('refuses to guess sizes independently of formats', () => {
      const tags = ev([
        ['encoding:contentUrl', 'https://x.example/a.pdf'],
        ['encoding:contentUrl', 'https://x.example/b.pdf'],
        ['encoding:encodingFormat', 'application/pdf'],
        ['encoding:encodingFormat', 'application/pdf'],
        ['encoding:contentSize', '100']
      ]);
      const { items } = describeLinkedMaterials(tags);
      expect(items.map((i) => i.type)).toEqual(['pdf', 'pdf']);
      expect(items.map((i) => i.size)).toEqual([null, null]);
    });

    it('trusts a single file even with nothing else present', () => {
      const tags = ev([
        ['encoding:contentUrl', 'https://x.example/a'],
        ['encoding:encodingFormat', 'application/pdf'],
        ['encoding:contentSize', '4096']
      ]);
      expect(describeLinkedMaterials(tags).items).toEqual([
        { source: 'upload', type: 'pdf', size: 4096 }
      ]);
    });
  });

  it('returns an empty description for a resource with no material', () => {
    expect(describeLinkedMaterials(ev([['title', 'x']]))).toEqual({ count: 0, items: [] });
  });

  it('survives missing, malformed and non-array tags', () => {
    expect(describeLinkedMaterials(undefined)).toEqual({ count: 0, items: [] });
    expect(describeLinkedMaterials(null)).toEqual({ count: 0, items: [] });
    expect(describeLinkedMaterials([])).toEqual({ count: 0, items: [] });
    // A tag with no value must not become an item with an undefined url
    expect(describeLinkedMaterials(ev([['encoding:contentUrl'], ['r', '']])).count).toBe(0);
  });
});
