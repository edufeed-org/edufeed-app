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
  reactionTargetId,
  reactionDisplayContent,
  rumorContent
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

describe('reactionDisplayContent', () => {
  it('renders the NIP-25 sentinels as emoji, never literally', () => {
    expect(reactionDisplayContent(rumor(7, [], '+'))).toBe('👍');
    expect(reactionDisplayContent(rumor(7, [], '-'))).toBe('👎');
    // NIP-25: empty content means "+"
    expect(reactionDisplayContent(rumor(7, [], ''))).toBe('👍');
    expect(reactionDisplayContent(rumor(7, [], '  '))).toBe('👍');
  });

  it('passes real emoji and NIP-30 shortcodes through unchanged', () => {
    expect(reactionDisplayContent(rumor(7, [], '🔥'))).toBe('🔥');
    expect(
      reactionDisplayContent(rumor(7, [['emoji', 'party', 'https://x/p.png']], ':party:'))
    ).toBe(':party:');
  });

  it('never throws on a malformed rumor', () => {
    expect(reactionDisplayContent(null)).toBe('👍');
    expect(reactionDisplayContent({ kind: 7, content: 42 })).toBe('👍');
  });
});

/**
 * A rumor is unsigned JSON decrypted out of a kind-1059 gift wrap — every
 * field is attacker-controlled. InboxDmItem renders this data from the navbar,
 * which sits OUTSIDE the route-level <svelte:boundary>, so a throw here blanks
 * the entire app on every route and stays blank because the wrap is cached.
 * Every exported helper must therefore be total.
 */
describe('malformed rumors (untrusted gift-wrap payloads)', () => {
  const malformed = [
    ['null', null],
    ['undefined', undefined],
    ['empty object', {}],
    ['numeric content', { kind: 15, content: 42 }],
    ['object content', { kind: 14, content: { toString: null } }],
    ['string tags', { kind: 15, tags: 'nope' }],
    ['ragged tags', { kind: 15, tags: [null, ['x'], 42, ['p'], ['p', 7]] }],
    ['numeric kind missing', { tags: [['p', PEER]], content: 'hi' }],
    ['string kind', { kind: '15', content: 'https://x/a.bin' }],
    ['array', []],
    ['string', 'not a rumor']
  ];

  for (const [label, value] of malformed) {
    it(`survives ${label}`, () => {
      expect(() => isDmMessageRumor(value)).not.toThrow();
      expect(() => isDmFileRumor(value)).not.toThrow();
      expect(() => isDmReactionRumor(value)).not.toThrow();
      expect(() => rumorParticipants(value)).not.toThrow();
      expect(() => rumorConversationId(value)).not.toThrow();
      expect(() => parseFileRumor(value)).not.toThrow();
      expect(() => reactionTargetId(value)).not.toThrow();
      expect(() => reactionDisplayContent(value)).not.toThrow();
      expect(() => rumorContent(value)).not.toThrow();

      // documented fallbacks: the shape callers rely on, never undefined
      expect(typeof isDmMessageRumor(value)).toBe('boolean');
      expect(typeof isDmFileRumor(value)).toBe('boolean');
      expect(typeof isDmReactionRumor(value)).toBe('boolean');
      expect(Array.isArray(rumorParticipants(value))).toBe(true);
      expect(typeof rumorConversationId(value)).toBe('string');
      expect(typeof rumorContent(value)).toBe('string');
      expect(typeof reactionDisplayContent(value)).toBe('string');
      expect(reactionTargetId(value)).toBeNull();
      expect(parseFileRumor(value)).toBeNull();
    });
  }

  it('returns the documented fallback values', () => {
    expect(isDmMessageRumor(null)).toBe(false);
    expect(isDmFileRumor(undefined)).toBe(false);
    expect(isDmReactionRumor({})).toBe(false);
    expect(isDmFileRumor({ kind: '15' })).toBe(false);
    expect(rumorParticipants(null)).toEqual([]);
    expect(rumorParticipants({ kind: 15, tags: 'nope' })).toEqual([]);
    expect(rumorParticipants({ pubkey: 42, tags: [null, ['p', PEER], ['p', 7]] })).toEqual([PEER]);
    expect(rumorConversationId(undefined)).toBe('');
    expect(parseFileRumor({ kind: 15, content: 42 })).toBeNull();
    expect(parseFileRumor({ kind: 15, tags: 'nope' })).toBeNull();
    expect(reactionTargetId({ kind: 7, tags: [null, 42, ['e']] })).toBeNull();
    expect(rumorContent({ content: 42 })).toBe('');
  });

  it('still parses a good file rumor that also carries junk tags', () => {
    const parsed = parseFileRumor({
      kind: 15,
      content: 'https://blossom.example/abc.bin',
      tags: [
        null,
        42,
        ['encryption-algorithm', 'aes-gcm'],
        ['decryption-key', 'ab'.repeat(16)],
        ['decryption-nonce', 'cd'.repeat(6)],
        ['file-type', 'image/png'],
        ['alt', 'a cat'],
        ['dim', 7]
      ]
    });
    expect(parsed).toMatchObject({
      url: 'https://blossom.example/abc.bin',
      mimeType: 'image/png',
      alt: 'a cat',
      dim: null
    });
  });
});
