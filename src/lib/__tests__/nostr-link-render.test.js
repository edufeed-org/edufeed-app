/**
 * Helpers backing rich link rendering in NostrContentRenderer:
 * - nostrIdFromUrl: pulls a NIP-19 id out of an app URL so the link can render
 *   as a preview card instead of a raw anchor.
 * - truncateMiddle: shortens long plain-link display text, keeping head + tail.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { nostrIdFromUrl, truncateMiddle, splitNostrIds } from '$lib/helpers/link-render.js';

describe('nostrIdFromUrl', () => {
  it('extracts an naddr from an app URL path', () => {
    expect(nostrIdFromUrl('http://localhost:5176/naddr1abc123def456')).toBe('naddr1abc123def456');
  });

  it('extracts an npub from a profile URL', () => {
    expect(nostrIdFromUrl('https://edufeed.org/p/npub1xyz789abc')).toBe('npub1xyz789abc');
  });

  it('strips a nostr: URI prefix', () => {
    expect(nostrIdFromUrl('https://edufeed.org/nostr:naddr1qqqq')).toBe('naddr1qqqq');
  });

  it('returns null for URLs with no nostr identifier', () => {
    expect(nostrIdFromUrl('https://www.bildungsserver.de/veranstaltung.html?id=42')).toBeNull();
  });

  it('returns null for empty / non-string input', () => {
    expect(nostrIdFromUrl('')).toBeNull();
    // @ts-expect-error testing bad input
    expect(nostrIdFromUrl(undefined)).toBeNull();
  });
});

describe('splitNostrIds', () => {
  it('splits a nostr id embedded in a localhost URL out of surrounding text', () => {
    const naddr = 'naddr1' + 'q'.repeat(40);
    const segs = splitNostrIds(`Resource: Test — http://localhost:5173/${naddr}\nField: Lizenz`);
    // The whole URL (prefix included) is consumed and replaced by the id segment.
    expect(segs).toEqual([
      { text: 'Resource: Test — ' },
      { id: naddr },
      { text: '\nField: Lizenz' }
    ]);
  });

  it('splits a bare nostr id with a nostr: prefix', () => {
    const segs = splitNostrIds('see nostr:npub1xyz789abc here');
    expect(segs).toEqual([{ text: 'see ' }, { id: 'npub1xyz789abc' }, { text: ' here' }]);
  });

  it('returns a single text segment when there is no nostr id', () => {
    expect(splitNostrIds('just plain text')).toEqual([{ text: 'just plain text' }]);
  });

  it('handles multiple ids in one string', () => {
    const a = 'note1' + 'a'.repeat(20);
    const b = 'naddr1' + 'b'.repeat(20);
    const segs = splitNostrIds(`${a} and ${b}`);
    expect(segs).toEqual([{ id: a }, { text: ' and ' }, { id: b }]);
  });
});

describe('truncateMiddle', () => {
  it('leaves strings at or under the limit unchanged', () => {
    expect(truncateMiddle('short text', 20)).toBe('short text');
  });

  it('keeps the head and tail with an ellipsis in the middle', () => {
    const long = 'edufeed.org/naddr1' + 'q'.repeat(60) + 'TAIL';
    const out = truncateMiddle(long, 24);
    expect(out.length).toBeLessThanOrEqual(25);
    expect(out).toContain('…');
    expect(out.startsWith('edufeed.org')).toBe(true);
    expect(out.endsWith('TAIL')).toBe(true);
  });
});
