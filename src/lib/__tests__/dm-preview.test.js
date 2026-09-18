/** @vitest-environment node */
/**
 * The list preview reads lastMessage.content. For a kind-15 file that content
 * is the blob URL, so without this the list shows a raw blossom link.
 */
import { describe, it, expect } from 'vitest';
import { dmPreviewText } from '$lib/helpers/dm-preview.js';

const t = { image: () => 'Photo', file: () => 'File' };
/** @param {string} mime */
const fileRumor = (mime) => ({
  kind: 15,
  content: 'https://blossom.example/a.bin',
  tags: [
    ['file-type', mime],
    ['encryption-algorithm', 'aes-gcm'],
    ['decryption-key', 'ab'.repeat(16)],
    ['decryption-nonce', 'cd'.repeat(6)]
  ]
});

describe('dmPreviewText', () => {
  it('passes chat text through', () => {
    expect(dmPreviewText({ kind: 14, content: 'hallo', tags: [] }, t)).toBe('hallo');
  });

  it('names an image instead of showing its url', () => {
    expect(dmPreviewText(fileRumor('image/jpeg'), t)).toBe('Photo');
  });

  it('names a non-image file', () => {
    expect(dmPreviewText(fileRumor('application/pdf'), t)).toBe('File');
  });

  it('falls back to the file label when the mime type is missing', () => {
    const noMime = {
      ...fileRumor('image/png'),
      tags: fileRumor('image/png').tags.filter((x) => x[0] !== 'file-type')
    };
    expect(dmPreviewText(noMime, t)).toBe('File');
  });

  it('is empty for a missing rumor', () => {
    expect(dmPreviewText(null, t)).toBe('');
  });
});
