/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  getMessageAttachments,
  classifyAttachment,
  stripAttachmentUrls
} from '$lib/concord/attachments.js';

const URL_A =
  'https://blossom.example.com/aa11bb22cc33dd44ee55ff6600112233445566778899aabbccddeeff00112233.bin';
const URL_B =
  'https://blossom.example.com/bb22cc33dd44ee55ff6600112233445566778899aabbccddeeff0011223344aa.pdf';
const KEY = 'f'.repeat(64);
const NONCE = '0'.repeat(32);

/** An encrypted-photo message the way Armada/applesauce-concord builds it:
 *  content carries the URL, the imeta tag decorates it (NIP-92 + the
 *  0xChat-compatible encryption fields from applesauce-concord helpers/imeta.js). */
function encryptedPhotoMessage() {
  return {
    id: 'msg1',
    content: `look at this ${URL_A}`,
    tags: [
      [
        'imeta',
        `url ${URL_A}`,
        'm image/jpeg',
        `ox ${'1'.repeat(64)}`,
        `x ${'2'.repeat(64)}`,
        'size 12345',
        'dim 800x600',
        'blurhash LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
        'encryption-algorithm aes-gcm',
        `decryption-key ${KEY}`,
        `decryption-nonce ${NONCE}`
      ]
    ]
  };
}

describe('getMessageAttachments', () => {
  it('parses an encrypted imeta attachment with all fields', () => {
    const atts = getMessageAttachments(encryptedPhotoMessage());
    expect(atts).toHaveLength(1);
    const att = atts[0];
    expect(att.url).toBe(URL_A);
    expect(att.type).toBe('image/jpeg');
    expect(att.originalSha256).toBe('1'.repeat(64));
    expect(att.sha256).toBe('2'.repeat(64));
    expect(att.size).toBe(12345);
    expect(att.dimensions).toBe('800x600');
    expect(att.blurhash).toBe('LKO2?U%2Tw=w]~RBVZRi};RPxuwH');
    expect(att.encryption).toEqual({ algorithm: 'aes-gcm', key: KEY, nonce: NONCE });
  });

  it('parses an unencrypted attachment (no encryption fields -> encryption undefined)', () => {
    const atts = getMessageAttachments({
      content: URL_B,
      tags: [['imeta', `url ${URL_B}`, 'm application/pdf']]
    });
    expect(atts).toHaveLength(1);
    expect(atts[0].encryption).toBeUndefined();
    expect(atts[0].type).toBe('application/pdf');
  });

  it('rejects malformed encryption (wrong key length / unknown algorithm) but keeps the attachment', () => {
    const badKey = getMessageAttachments({
      content: '',
      tags: [
        [
          'imeta',
          `url ${URL_A}`,
          'm image/png',
          'encryption-algorithm aes-gcm',
          'decryption-key beef',
          `decryption-nonce ${NONCE}`
        ]
      ]
    });
    expect(badKey).toHaveLength(1);
    expect(badKey[0].encryption).toBeUndefined();

    const badAlgo = getMessageAttachments({
      content: '',
      tags: [
        [
          'imeta',
          `url ${URL_A}`,
          'm image/png',
          'encryption-algorithm rot13',
          `decryption-key ${KEY}`,
          `decryption-nonce ${NONCE}`
        ]
      ]
    });
    expect(badAlgo[0].encryption).toBeUndefined();
  });

  it('skips imeta tags without a url, keeps order of multiple attachments', () => {
    const atts = getMessageAttachments({
      content: '',
      tags: [
        ['imeta', 'm image/png'],
        ['imeta', `url ${URL_A}`, 'm image/jpeg'],
        ['imeta', `url ${URL_B}`, 'm application/pdf']
      ]
    });
    expect(atts.map((a) => a.url)).toEqual([URL_A, URL_B]);
  });

  it('returns [] for messages without imeta tags (and tolerates missing tags)', () => {
    expect(getMessageAttachments({ content: 'hi', tags: [['p', 'x'.repeat(64)]] })).toEqual([]);
    expect(getMessageAttachments({ content: 'hi' })).toEqual([]);
    expect(getMessageAttachments(null)).toEqual([]);
  });

  it('parses identically to applesauce-concord parseImeta (parity guard for the pure reimplementation)', async () => {
    const { parseImeta } = await import('applesauce-concord/helpers');
    const msg = encryptedPhotoMessage();
    const theirs = parseImeta(msg.tags).get(URL_A);
    const ours = getMessageAttachments(msg)[0];
    expect(ours).toEqual(theirs);
  });
});

describe('classifyAttachment', () => {
  it('classifies by mime prefix with file fallback', () => {
    expect(classifyAttachment({ type: 'image/jpeg' })).toBe('image');
    expect(classifyAttachment({ type: 'video/mp4' })).toBe('video');
    expect(classifyAttachment({ type: 'audio/ogg' })).toBe('audio');
    expect(classifyAttachment({ type: 'application/pdf' })).toBe('file');
    expect(classifyAttachment({})).toBe('file');
  });
});

describe('stripAttachmentUrls', () => {
  const atts = [{ url: URL_A }, { url: URL_B }];

  it('removes attachment URLs and collapses whitespace, keeping prose', () => {
    expect(stripAttachmentUrls(`look at this ${URL_A}`, atts)).toBe('look at this');
    expect(stripAttachmentUrls(`${URL_A}\n\ncaption below ${URL_B} end`, atts)).toBe(
      'caption below end'
    );
  });

  it('returns empty string for URL-only content', () => {
    expect(stripAttachmentUrls(`${URL_A} ${URL_B}`, atts)).toBe('');
    expect(stripAttachmentUrls(URL_A, [{ url: URL_A }])).toBe('');
  });

  it('leaves non-attachment URLs and plain text untouched', () => {
    const text = 'see https://example.org/page and more';
    expect(stripAttachmentUrls(text, atts)).toBe(text);
    expect(stripAttachmentUrls('no urls here', atts)).toBe('no urls here');
  });

  it('handles empty attachments / empty content', () => {
    expect(stripAttachmentUrls('text', [])).toBe('text');
    expect(stripAttachmentUrls('', atts)).toBe('');
  });
});
