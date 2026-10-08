// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  linkifyCallChat,
  callChatPreviewUrls,
  withCustomEmojis
} from '$lib/groups/call-chat-links.js';

const ORIGIN = 'https://edufeed.org';
const NADDR = 'naddr1' + 'q'.repeat(70);
const NPUB = 'npub1' + 'q'.repeat(58);

describe('linkifyCallChat', () => {
  it('returns plain text as one text segment', () => {
    expect(linkifyCallChat('Hallo zusammen', ORIGIN)).toEqual([{ text: 'Hallo zusammen' }]);
  });

  it('turns an external URL into an external link and keeps the text around it', () => {
    expect(linkifyCallChat('schau mal https://example.com/a?b=1 hier', ORIGIN)).toEqual([
      { text: 'schau mal ' },
      { href: 'https://example.com/a?b=1', label: 'https://example.com/a?b=1', internal: false },
      { text: ' hier' }
    ]);
  });

  it('leaves trailing sentence punctuation out of the link', () => {
    const segs = linkifyCallChat(
      'Siehe https://example.com/x. Und (https://example.org/y)!',
      ORIGIN
    );
    const links = segs.filter((s) => 'href' in s).map((s) => /** @type {any} */ (s).href);
    expect(links).toEqual(['https://example.com/x', 'https://example.org/y']);
    expect(segs.map((s) => ('href' in s ? s.label : s.text)).join('')).toBe(
      'Siehe https://example.com/x. Und (https://example.org/y)!'
    );
  });

  it('keeps balanced parentheses inside a URL', () => {
    const [seg] = linkifyCallChat('https://de.wikipedia.org/wiki/Test_(Begriff)', ORIGIN);
    expect(seg).toMatchObject({ href: 'https://de.wikipedia.org/wiki/Test_(Begriff)' });
  });

  it('makes a same-origin app URL an internal path', () => {
    const [seg] = linkifyCallChat(`${ORIGIN}/${NADDR}?tab=x#y`, ORIGIN);
    expect(seg).toEqual({
      href: `/${NADDR}?tab=x#y`,
      label: `${ORIGIN}/${NADDR}?tab=x#y`,
      internal: true
    });
  });

  it('makes nostr: URIs and bare NIP-19 ids internal app paths', () => {
    const segs = linkifyCallChat(`nostr:${NPUB} und ${NADDR}`, ORIGIN);
    expect(segs).toEqual([
      { href: `/${NPUB}`, label: `nostr:${NPUB}`, internal: true },
      { text: ' und ' },
      { href: `/${NADDR}`, label: NADDR, internal: true }
    ]);
  });

  it('never links non-http schemes or html', () => {
    const text = 'javascript:alert(1) <a href="x">y</a> data:text/html,hi';
    expect(linkifyCallChat(text, ORIGIN)).toEqual([{ text }]);
  });

  it('copes with empty input', () => {
    expect(linkifyCallChat('', ORIGIN)).toEqual([{ text: '' }]);
  });
});

describe('callChatPreviewUrls', () => {
  it('previews external pages only — no app links, no images, deduped, max 3', () => {
    const segs = linkifyCallChat(
      [
        'https://a.example/1',
        'https://a.example/1',
        `${ORIGIN}/${NADDR}`,
        `nostr:${NPUB}`,
        'https://img.example/p.png',
        'https://b.example/2',
        'https://c.example/3',
        'https://d.example/4'
      ].join(' '),
      ORIGIN
    );
    expect(callChatPreviewUrls(segs)).toEqual([
      'https://a.example/1',
      'https://b.example/2',
      'https://c.example/3'
    ]);
  });
});

// Issue "emoji picker and :shortcode: autocomplete": a NIP-30 custom emoji
// the sender declared (payload `emoji` pairs) renders as its image; a
// `:code:` nobody declared stays text.
describe('withCustomEmojis', () => {
  const PARTY = ['party', 'https://cdn.example/party.png'];

  it('splits declared shortcodes out of text segments', () => {
    expect(withCustomEmojis([{ text: 'los :party: jetzt' }], [PARTY])).toEqual([
      { text: 'los ' },
      { emoji: 'party', url: 'https://cdn.example/party.png' },
      { text: ' jetzt' }
    ]);
  });

  it('leaves undeclared shortcodes and link segments alone', () => {
    const link = { href: 'https://example.com/:party:', label: 'x', internal: false };
    expect(withCustomEmojis([{ text: ':nope: :party:' }, link], [PARTY])).toEqual([
      { text: ':nope: ' },
      { emoji: 'party', url: 'https://cdn.example/party.png' },
      link
    ]);
  });

  it('returns the segments untouched without declared emojis', () => {
    const segs = [{ text: ':party:' }];
    expect(withCustomEmojis(segs, undefined)).toBe(segs);
    expect(withCustomEmojis(segs, [])).toBe(segs);
  });

  it('handles a shortcode repeated and at the very ends', () => {
    expect(withCustomEmojis([{ text: ':party::party:' }], [PARTY])).toEqual([
      { emoji: 'party', url: 'https://cdn.example/party.png' },
      { emoji: 'party', url: 'https://cdn.example/party.png' }
    ]);
  });
});
