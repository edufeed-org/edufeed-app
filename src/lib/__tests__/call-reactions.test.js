/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  isReactionEmoji,
  normalizeCustomEmoji,
  reactionPayload,
  parseReactionPayload
} from '$lib/groups/call-reactions.js';

describe('isReactionEmoji: any single unicode emoji, nothing else', () => {
  it.each(['👍', '❤️', '🎉', '👍🏽', '👩‍💻', '🇩🇪', '1️⃣', '🏳️‍🌈', '🫶'])('accepts %s', (e) => {
    expect(isReactionEmoji(e)).toBe(true);
  });
  it.each(['', 'a', 'hi', '💣 boom', '12', ' ', '<img>', '👍'.repeat(20), 42, null])(
    'refuses %s',
    (e) => {
      expect(isReactionEmoji(e)).toBe(false);
    }
  );
});

describe('normalizeCustomEmoji: NIP-30 shortcode + https image only', () => {
  it('keeps a valid shortcode and https url', () => {
    expect(normalizeCustomEmoji({ shortcode: 'party_parrot', url: 'https://x.org/p.gif' })).toEqual(
      { shortcode: 'party_parrot', url: 'https://x.org/p.gif' }
    );
  });
  it.each([
    [{ shortcode: 'ok', url: 'http://x.org/p.gif' }],
    [{ shortcode: 'ok', url: 'javascript:alert(1)' }],
    [{ shortcode: 'ok', url: 'data:image/png;base64,AAAA' }],
    [{ shortcode: 'ok', url: 'https://x.org/' + 'a'.repeat(1100) }],
    [{ shortcode: 'not ok', url: 'https://x.org/p.gif' }],
    [{ shortcode: 'a'.repeat(65), url: 'https://x.org/p.gif' }],
    [{ shortcode: '', url: 'https://x.org/p.gif' }],
    [{ shortcode: 'ok' }],
    ['nope'],
    [null]
  ])('refuses %j', (c) => {
    expect(normalizeCustomEmoji(c)).toBeNull();
  });
});

describe('reaction payloads on the wire', () => {
  it('a unicode reaction stays the old shape (old clients understand the default ones)', () => {
    expect(reactionPayload('👍', 'n1')).toEqual({ t: 'react', e: '👍', n: 'n1' });
  });

  it('a custom emoji travels as :shortcode: plus an optional {shortcode, url}', () => {
    expect(reactionPayload({ shortcode: 'parrot', url: 'https://x.org/p.gif' }, 'n2')).toEqual({
      t: 'react',
      e: ':parrot:',
      n: 'n2',
      custom: { shortcode: 'parrot', url: 'https://x.org/p.gif' }
    });
  });

  it('refuses to build an invalid one', () => {
    expect(reactionPayload('hello', 'n')).toBeNull();
    expect(reactionPayload({ shortcode: 'x', url: 'http://x' }, 'n')).toBeNull();
  });

  it('parses unicode and custom reactions; ignores unknown extra fields', () => {
    expect(parseReactionPayload({ t: 'react', e: '🫶', n: 'a', future: 1 })).toEqual({
      emoji: '🫶',
      nonce: 'a'
    });
    expect(
      parseReactionPayload({
        t: 'react',
        e: ':parrot:',
        n: 'b',
        custom: { shortcode: 'parrot', url: 'https://x.org/p.gif' }
      })
    ).toEqual({ emoji: ':parrot:', url: 'https://x.org/p.gif', nonce: 'b' });
  });

  it('drops bad ones: wrong type, bad nonce, bad emoji, bad custom, mismatched shortcode', () => {
    expect(parseReactionPayload({ t: 'hand', e: '👍', n: 'a' })).toBeNull();
    expect(parseReactionPayload({ t: 'react', e: '👍', n: '' })).toBeNull();
    expect(parseReactionPayload({ t: 'react', e: '👍', n: 'x'.repeat(33) })).toBeNull();
    expect(parseReactionPayload({ t: 'react', e: '💣 boom', n: 'a' })).toBeNull();
    expect(
      parseReactionPayload({
        t: 'react',
        e: ':parrot:',
        n: 'a',
        custom: { shortcode: 'parrot', url: 'http://x.org/p.gif' }
      })
    ).toBeNull();
    expect(
      parseReactionPayload({
        t: 'react',
        e: ':other:',
        n: 'a',
        custom: { shortcode: 'parrot', url: 'https://x.org/p.gif' }
      })
    ).toBeNull();
  });
});
