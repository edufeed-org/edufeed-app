/**
 * Tests for media-meta helpers — NIP-92 imeta lookup + display helpers
 * used by the feed media rendering (NostrContentRenderer).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  getImetaByUrl,
  parseImetaDimensions,
  formatMediaDuration,
  attachmentDisplayName,
  formatFileSize
} from '../helpers/media-meta.js';

/** @param {string[][]} tags */
function eventWithTags(tags) {
  return {
    id: 'e'.repeat(64),
    kind: 1,
    pubkey: 'f'.repeat(64),
    created_at: 1700000000,
    content: '',
    tags,
    sig: ''
  };
}

describe('getImetaByUrl', () => {
  it('maps imeta tag fields by normalized URL', () => {
    const event = eventWithTags([
      [
        'imeta',
        'url https://example.com/photo.jpg',
        'dim 800x600',
        'm image/jpeg',
        'alt A test photo'
      ]
    ]);
    const map = getImetaByUrl(event);
    const fields = map.get(new URL('https://example.com/photo.jpg').toString());
    expect(fields).toBeTruthy();
    expect(fields?.dimensions).toBe('800x600');
    expect(fields?.alt).toBe('A test photo');
  });

  it('returns an empty map for events without imeta tags', () => {
    const map = getImetaByUrl(eventWithTags([['p', 'a'.repeat(64)]]));
    expect(map.size).toBe(0);
  });

  it('carries the NIP-94 name field (original filename) for file cards', () => {
    // applesauce's FileMetadataFields has no `name`, but chat uploads (ours and
    // Armada's) write it so file cards can show the original filename.
    const event = eventWithTags([
      ['imeta', 'url https://example.com/abc.pdf', 'm application/pdf', 'name worksheet.pdf']
    ]);
    const fields = getImetaByUrl(event).get('https://example.com/abc.pdf');
    expect(fields?.name).toBe('worksheet.pdf');
  });

  it('skips imeta tags with invalid URLs', () => {
    const event = eventWithTags([['imeta', 'url not a url', 'dim 10x10']]);
    expect(getImetaByUrl(event).size).toBe(0);
  });
});

describe('parseImetaDimensions', () => {
  it('parses "WxH" into numbers', () => {
    expect(parseImetaDimensions({ dimensions: '800x1066' })).toEqual({ width: 800, height: 1066 });
  });

  it('returns undefined for missing or malformed dimensions', () => {
    expect(parseImetaDimensions(undefined)).toBeUndefined();
    expect(parseImetaDimensions({})).toBeUndefined();
    expect(parseImetaDimensions({ dimensions: 'huge' })).toBeUndefined();
    expect(parseImetaDimensions({ dimensions: '0x0' })).toBeUndefined();
  });
});

describe('formatMediaDuration', () => {
  it('formats seconds as m:ss', () => {
    expect(formatMediaDuration(124)).toBe('2:04');
    expect(formatMediaDuration(9)).toBe('0:09');
  });

  it('formats an hour or more as h:mm:ss', () => {
    expect(formatMediaDuration(3671)).toBe('1:01:11');
  });

  it('returns undefined for non-finite or negative values', () => {
    expect(formatMediaDuration(NaN)).toBeUndefined();
    expect(formatMediaDuration(Infinity)).toBeUndefined();
    expect(formatMediaDuration(-5)).toBeUndefined();
  });
});

describe('attachmentDisplayName', () => {
  it('prefers the imeta name over the URL basename', () => {
    expect(
      attachmentDisplayName('https://b.example/' + 'a'.repeat(64) + '.pdf', {
        name: 'worksheet.pdf'
      })
    ).toBe('worksheet.pdf');
  });

  it('falls back to the URL basename, shortening a sha256 hash segment', () => {
    expect(attachmentDisplayName('https://b.example/' + 'a'.repeat(64) + '.pdf', undefined)).toBe(
      'aaaaaaaaaa….pdf'
    );
    expect(attachmentDisplayName('https://b.example/report.pdf', {})).toBe('report.pdf');
  });

  it('falls back to the host for URLs without a path basename', () => {
    expect(attachmentDisplayName('https://b.example/', undefined)).toBe('b.example');
  });
});

describe('formatFileSize', () => {
  it('formats bytes into a human-readable unit', () => {
    expect(formatFileSize(500)).toBe('500 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('returns undefined for missing or invalid sizes', () => {
    expect(formatFileSize(undefined)).toBeUndefined();
    expect(formatFileSize(0)).toBeUndefined();
    expect(formatFileSize(NaN)).toBeUndefined();
  });
});
