/** @vitest-environment node */
/**
 * Rumor helpers for NIP-17 messages. applesauce's getConversationParticipants
 * throws for anything but kinds 4/14, so file messages (15) and private
 * reactions (7) need our own participant/identity maths.
 */
import { describe, it, expect } from 'vitest';
import {
  DM_MESSAGE_KINDS,
  isDmMessageRumor,
  isDmFileRumor,
  isDmReactionRumor,
  rumorParticipants,
  rumorConversationId,
  parseFileRumor,
  reactionTargetId
} from '$lib/helpers/dm-rumors.js';

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);

/** @param {number} kind @param {string[][]} [tags] @param {string} [content] */
const rumor = (kind, tags = [], content = '') => ({
  id: 'c'.repeat(64),
  pubkey: ME,
  kind,
  created_at: 1000,
  tags,
  content
});

describe('kind predicates', () => {
  it('treats chat (14) and file (15) rumors as messages, nothing else', () => {
    expect(DM_MESSAGE_KINDS).toEqual([14, 15]);
    expect(isDmMessageRumor(rumor(14))).toBe(true);
    expect(isDmMessageRumor(rumor(15))).toBe(true);
    expect(isDmMessageRumor(rumor(7))).toBe(false);
    expect(isDmMessageRumor(rumor(1))).toBe(false);
    expect(isDmMessageRumor(undefined)).toBe(false);
  });

  it('separates file rumors and reaction rumors', () => {
    expect(isDmFileRumor(rumor(15))).toBe(true);
    expect(isDmFileRumor(rumor(14))).toBe(false);
    expect(isDmReactionRumor(rumor(7))).toBe(true);
    expect(isDmReactionRumor(rumor(14))).toBe(false);
  });
});

describe('rumorParticipants / rumorConversationId', () => {
  it('is the author plus every p tag, deduped', () => {
    expect(rumorParticipants(rumor(14, [['p', PEER]]))).toEqual([ME, PEER]);
    expect(
      rumorParticipants(
        rumor(14, [
          ['p', PEER],
          ['p', PEER],
          ['p', ME]
        ])
      )
    ).toEqual([ME, PEER]);
  });

  it('works for file and reaction rumors, which applesauce refuses', () => {
    expect(rumorParticipants(rumor(15, [['p', PEER]]))).toEqual([ME, PEER]);
    expect(rumorParticipants(rumor(7, [['p', PEER]]))).toEqual([ME, PEER]);
  });

  it('ignores malformed p tags (untrusted input)', () => {
    expect(rumorParticipants(rumor(14, [['p'], ['p', ''], ['e', PEER]]))).toEqual([ME]);
  });

  it('builds the same identifier applesauce does: sorted, colon-joined', () => {
    const id = rumorConversationId(rumor(14, [['p', PEER]]));
    expect(id).toBe([ME, PEER].sort().join(':'));
    expect(rumorConversationId(rumor(15, [['p', PEER]]))).toBe(id);
  });
});

describe('parseFileRumor', () => {
  const fileTags = [
    ['p', PEER],
    ['file-type', 'image/jpeg'],
    ['encryption-algorithm', 'aes-gcm'],
    ['decryption-key', 'ab'.repeat(16)],
    ['decryption-nonce', 'cd'.repeat(6)],
    ['x', 'e'.repeat(64)],
    ['size', '2048'],
    ['dim', '800x600'],
    ['blurhash', 'LKO2']
  ];

  it('reads the url from content and the crypto material from tags', () => {
    const parsed = parseFileRumor(rumor(15, fileTags, 'https://blossom.example/abc.bin'));
    expect(parsed).toMatchObject({
      url: 'https://blossom.example/abc.bin',
      mimeType: 'image/jpeg',
      algorithm: 'aes-gcm',
      key: 'ab'.repeat(16),
      nonce: 'cd'.repeat(6),
      hash: 'e'.repeat(64),
      size: 2048,
      dim: '800x600',
      blurhash: 'LKO2'
    });
  });

  it('returns null when the url or the crypto material is missing', () => {
    expect(parseFileRumor(rumor(15, fileTags, ''))).toBeNull();
    const noKey = fileTags.filter((t) => t[0] !== 'decryption-key');
    expect(parseFileRumor(rumor(15, noKey, 'https://x/a.bin'))).toBeNull();
  });

  it('refuses a non-http url — never hand javascript: to fetch', () => {
    expect(parseFileRumor(rumor(15, fileTags, 'javascript:alert(1)'))).toBeNull();
  });

  it('returns null for a non-file rumor', () => {
    expect(parseFileRumor(rumor(14, fileTags, 'https://x/a.bin'))).toBeNull();
  });

  it('tolerates a missing size/dim/blurhash', () => {
    const minimal = fileTags.filter((t) => !['size', 'dim', 'blurhash'].includes(t[0]));
    const parsed = parseFileRumor(rumor(15, minimal, 'https://x/a.bin'));
    expect(parsed?.size).toBeNull();
    expect(parsed?.dim).toBeNull();
  });
});

describe('reactionTargetId', () => {
  it('is the first e tag', () => {
    expect(reactionTargetId(rumor(7, [['e', 'f'.repeat(64)]], '+'))).toBe('f'.repeat(64));
  });

  it('is null without one', () => {
    expect(reactionTargetId(rumor(7, [['p', PEER]], '+'))).toBeNull();
  });
});
