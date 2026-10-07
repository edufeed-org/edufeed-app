/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  CALL_FILE_PREVIEW_TYPES,
  isPreviewableCallFile,
  safeCallFileType
} from '$lib/groups/call-files.js';

// A received call file is a same-origin blob: the sender's MIME type must
// never turn it into a document that runs script in the app's origin.
describe('call file types', () => {
  it('previews exactly the raster image allowlist', () => {
    expect([...CALL_FILE_PREVIEW_TYPES]).toEqual([
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp'
    ]);
    expect(isPreviewableCallFile('image/png')).toBe(true);
    expect(isPreviewableCallFile('IMAGE/JPEG')).toBe(true);
    expect(isPreviewableCallFile('image/svg+xml')).toBe(false);
    expect(isPreviewableCallFile('text/html')).toBe(false);
    expect(isPreviewableCallFile(undefined)).toBe(false);
  });

  it('types anything outside the allowlist as an opaque download', () => {
    expect(safeCallFileType('image/webp')).toBe('image/webp');
    expect(safeCallFileType('Image/PNG')).toBe('image/png');
    expect(safeCallFileType('text/html')).toBe('application/octet-stream');
    expect(safeCallFileType('image/svg+xml')).toBe('application/octet-stream');
    expect(safeCallFileType('application/pdf')).toBe('application/octet-stream');
    expect(safeCallFileType('')).toBe('application/octet-stream');
    expect(safeCallFileType(null)).toBe('application/octet-stream');
  });
});
