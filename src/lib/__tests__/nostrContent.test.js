/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { parseEventContent } from '$lib/helpers/nostrContent.js';

/**
 * Helper to create a minimal Nostr event
 * @param {string} content
 * @param {string[][]} [tags]
 * @returns {import('nostr-tools').Event}
 */
function makeEvent(content, tags = []) {
  return {
    id: 'abc123',
    pubkey: 'deadbeef'.repeat(8),
    created_at: Math.floor(Date.now() / 1000),
    kind: 1111,
    tags,
    content,
    sig: '0'.repeat(128)
  };
}

describe('parseEventContent', () => {
  it('parses plain text into a single text node', () => {
    const event = makeEvent('Hello world');
    const tree = parseEventContent(event);

    expect(tree.type).toBe('root');
    expect(tree.children.length).toBeGreaterThanOrEqual(1);

    const textNodes = tree.children.filter((n) => n.type === 'text');
    const combined = textNodes.map((n) => n.value).join('');
    expect(combined).toContain('Hello world');
  });

  it('parses :shortcode: with matching emoji tag into emoji node', () => {
    const event = makeEvent('Look :pepe:', [['emoji', 'pepe', 'https://example.com/pepe.png']]);
    const tree = parseEventContent(event);

    const emojiNode = tree.children.find((n) => n.type === 'emoji');
    expect(emojiNode).toBeDefined();
    expect(/** @type {any} */ (emojiNode).code).toBe('pepe');
    expect(/** @type {any} */ (emojiNode).url).toBe('https://example.com/pepe.png');
  });

  it('keeps :shortcode: as text when no matching emoji tag exists', () => {
    const event = makeEvent('Look :missing:');
    const tree = parseEventContent(event);

    const emojiNode = tree.children.find((n) => n.type === 'emoji');
    expect(emojiNode).toBeUndefined();

    const textContent = tree.children
      .filter((n) => n.type === 'text')
      .map((n) => n.value)
      .join('');
    expect(textContent).toContain(':missing:');
  });

  it('parses nostr:npub1... into a mention node', () => {
    const npub = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzqujme';
    const event = makeEvent(`Check nostr:${npub}`);
    const tree = parseEventContent(event);

    const mentionNode = tree.children.find((n) => n.type === 'mention');
    expect(mentionNode).toBeDefined();
    expect(/** @type {any} */ (mentionNode).encoded).toBe(npub);
    expect(/** @type {any} */ (mentionNode).decoded).toBeDefined();
  });

  it('parses https:// URLs into link nodes', () => {
    const event = makeEvent('Visit https://example.com/page for info');
    const tree = parseEventContent(event);

    const linkNode = tree.children.find((n) => n.type === 'link');
    expect(linkNode).toBeDefined();
    expect(/** @type {any} */ (linkNode).href).toBe('https://example.com/page');
  });

  it('parses #hashtag into hashtag nodes', () => {
    const event = makeEvent('Check out #nostr', [['t', 'nostr']]);
    const tree = parseEventContent(event);

    const hashtagNode = tree.children.find((n) => n.type === 'hashtag');
    expect(hashtagNode).toBeDefined();
    expect(/** @type {any} */ (hashtagNode).name).toBe('nostr');
  });

  it('parses mixed content into correct node sequence', () => {
    const event = makeEvent(
      'Hello :yes: check nostr:npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzqujme and https://example.com #nostr',
      [
        ['emoji', 'yes', 'https://example.com/yes.png'],
        ['t', 'nostr']
      ]
    );
    const tree = parseEventContent(event);

    const types = tree.children.map((n) => n.type);
    expect(types).toContain('text');
    expect(types).toContain('emoji');
    expect(types).toContain('mention');
    expect(types).toContain('link');
    expect(types).toContain('hashtag');
  });

  it('caches parsed content on the event (same result on second call)', () => {
    const event = makeEvent('Hello :yes:', [['emoji', 'yes', 'https://example.com/yes.png']]);
    const tree1 = parseEventContent(event);
    const tree2 = parseEventContent(event);

    expect(tree1).toBe(tree2);
  });
});
