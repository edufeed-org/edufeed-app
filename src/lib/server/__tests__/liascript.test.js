/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { liascriptMarkdown, isBlockedPubkey } from '$lib/server/liascript.js';

const PK = '1c5ff3caacd842c01dca8f378231b16617516d214da75c7aeabbe9e1efe9c0f6';
const NPUB = nip19.npubEncode(PK);

/** @param {string[][]} tags @param {string} content */
const article = (tags, content) => ({ kind: 30023, pubkey: PK, tags, content });

describe('liascriptMarkdown', () => {
  it('writes the LiaScript header, a title heading and the content', () => {
    const md = liascriptMarkdown(
      article(
        [
          ['d', 'x'],
          ['title', 'OER-Lizenzen'],
          ['summary', 'Kurz erklärt.\nZweite Zeile']
        ],
        'Text.'
      )
    );
    expect(md).toBe(
      [
        '<!--',
        `author: ${NPUB.slice(0, 9)}…${NPUB.slice(-4)}`,
        'version: 1.0.0',
        'language: de',
        'narrator: Deutsch Female',
        'comment: Kurz erklärt. Zweite Zeile',
        '-->',
        '',
        '# OER-Lizenzen',
        '',
        'Text.'
      ].join('\n')
    );
  });

  it('keeps the content heading instead of adding the title', () => {
    const md = liascriptMarkdown(article([['title', 'T']], '# Eigene Überschrift\n\nText'));
    expect(md).not.toContain('# T\n');
    expect(md.endsWith('-->\n\n# Eigene Überschrift\n\nText')).toBe(true);
  });

  it('takes the language tag, picks the English narrator and omits an empty comment', () => {
    const md = liascriptMarkdown(article([['l', 'en', 'ISO-639-1']], 'Hi'));
    expect(md).toContain('language: en\nnarrator: US English Female\n-->');
    expect(md).not.toContain('comment:');
  });

  it('ignores a non-language l tag and caps a long summary at 200 characters', () => {
    const md = liascriptMarkdown(
      article(
        [
          ['l', 'tutorial', 'ugc'],
          ['summary', 'a'.repeat(300)]
        ],
        'x'
      )
    );
    expect(md).toContain('language: de');
    expect(md).toContain(`comment: ${'a'.repeat(200)}\n`);
  });

  it('cannot close the header comment early', () => {
    const md = liascriptMarkdown(article([['summary', 'evil --> <script>']], 'x'));
    expect(md.indexOf('-->')).toBe(md.lastIndexOf('-->'));
  });
});

describe('isBlockedPubkey', () => {
  it('matches hex and npub entries, ignores list naddrs and blanks', () => {
    expect(isBlockedPubkey(PK, `naddr1xyz, ${NPUB}`)).toBe(true);
    expect(isBlockedPubkey(PK, PK.toUpperCase())).toBe(true);
    expect(isBlockedPubkey(PK, 'f'.repeat(64))).toBe(false);
    expect(isBlockedPubkey(PK, undefined)).toBe(false);
  });
});
