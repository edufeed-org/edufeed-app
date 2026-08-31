/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  getThumbnailSourceUrl,
  canDeriveThumbnail,
  pdfThumbnailEndpoint,
  pdfInfoEndpoint
} from '$lib/helpers/educational/pdfThumbnailGate.js';

const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';

/** @param {string[][]} tags */
const ev = (tags) => tags;

describe('getThumbnailSourceUrl', () => {
  it('returns the first PDF encoding url (by mime type)', () => {
    const tags = ev([
      ['encoding:contentUrl', 'https://x.example/a'],
      ['encoding:encodingFormat', 'application/pdf']
    ]);
    expect(getThumbnailSourceUrl(tags)).toBe('https://x.example/a');
  });

  it('detects PDFs by url extension when no mime is present', () => {
    const tags = ev([['encoding:contentUrl', 'https://x.example/paper.PDF']]);
    expect(getThumbnailSourceUrl(tags)).toBe('https://x.example/paper.PDF');
  });

  it('returns null for non-PDF encodings or none at all', () => {
    expect(
      getThumbnailSourceUrl(
        ev([
          ['encoding:contentUrl', 'https://x.example/video.mp4'],
          ['encoding:encodingFormat', 'video/mp4']
        ])
      )
    ).toBe(null);
    expect(getThumbnailSourceUrl(ev([['d', 'x']]))).toBe(null);
  });
});

describe('canDeriveThumbnail', () => {
  it('allows PDFs on openly licensed resources', () => {
    const tags = ev([
      ['license:id', CC_BY],
      ['encoding:contentUrl', 'https://journal.example/dl/1'],
      ['encoding:encodingFormat', 'application/pdf']
    ]);
    expect(canDeriveThumbnail(tags)).toBe(true);
  });

  it('allows attested Blossom uploads regardless of license field', () => {
    const tags = ev([
      ['encoding:contentUrl', 'https://blossom.example/abc.pdf'],
      ['encoding:encodingFormat', 'application/pdf'],
      ['encoding:sha256', 'deadbeef']
    ]);
    expect(canDeriveThumbnail(tags)).toBe(true);
  });

  it('blocks external links without an open license', () => {
    const tags = ev([
      ['license:id', 'https://example.org/all-rights-reserved'],
      ['encoding:contentUrl', 'https://journal.example/dl/1'],
      ['encoding:encodingFormat', 'application/pdf']
    ]);
    expect(canDeriveThumbnail(tags)).toBe(false);
    // no license at all
    expect(
      canDeriveThumbnail(
        ev([
          ['encoding:contentUrl', 'https://journal.example/dl/1'],
          ['encoding:encodingFormat', 'application/pdf']
        ])
      )
    ).toBe(false);
  });

  it('accepts CC0 / public domain marks as open', () => {
    const tags = ev([
      ['license:id', 'https://creativecommons.org/publicdomain/zero/1.0/'],
      ['encoding:contentUrl', 'https://journal.example/dl/1.pdf']
    ]);
    expect(canDeriveThumbnail(tags)).toBe(true);
  });

  it('returns false when there is no PDF at all', () => {
    expect(canDeriveThumbnail(ev([['license:id', CC_BY]]))).toBe(false);
  });
});

describe('pdfThumbnailEndpoint', () => {
  it('builds the endpoint url', () => {
    expect(pdfThumbnailEndpoint('https://x.example/a b.pdf')).toBe(
      '/api/pdf-thumbnail?url=https%3A%2F%2Fx.example%2Fa%20b.pdf'
    );
  });
});

describe('pdfInfoEndpoint', () => {
  it('builds the endpoint url', () => {
    expect(pdfInfoEndpoint('https://x.example/a b.pdf')).toBe(
      '/api/pdf-info?url=https%3A%2F%2Fx.example%2Fa%20b.pdf'
    );
  });

  it('escapes a url that would otherwise inject another query parameter', () => {
    // `&`/`?` in a filename must stay inside the `url` value — an unescaped one
    // would hand the endpoint a second parameter it never validated.
    expect(pdfInfoEndpoint('https://x.example/a?b=1&c=2.pdf')).toBe(
      '/api/pdf-info?url=https%3A%2F%2Fx.example%2Fa%3Fb%3D1%26c%3D2.pdf'
    );
  });
});
