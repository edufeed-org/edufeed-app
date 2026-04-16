/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { getFeedCardData } from '../helpers/feedCardData.js';

describe('getFeedCardData', () => {
  describe('kind 39701 (bookmark)', () => {
    it('returns typeKey "bookmark" with title tag as title', () => {
      const event = {
        kind: 39701,
        content: 'Great article about Nostr',
        tags: [
          ['d', 'example.com/article'],
          ['title', 'Nostr Introduction']
        ]
      };
      const result = getFeedCardData(event);
      expect(result.typeKey).toBe('bookmark');
      expect(result.title).toBe('Nostr Introduction');
    });

    it('falls back to URL from d tag when no title tag', () => {
      const event = {
        kind: 39701,
        content: '',
        tags: [['d', 'example.com/article']]
      };
      const result = getFeedCardData(event);
      expect(result.title).toBe('https://example.com/article');
    });

    it('includes URL as subtitle', () => {
      const event = {
        kind: 39701,
        content: '',
        tags: [
          ['d', 'example.com/page'],
          ['title', 'My Page']
        ]
      };
      const result = getFeedCardData(event);
      expect(result.subtitle).toBe('https://example.com/page');
    });

    it('falls back to "Bookmark" when no d tag or title', () => {
      const event = { kind: 39701, content: '', tags: [] };
      const result = getFeedCardData(event);
      expect(result.typeKey).toBe('bookmark');
      expect(result.title).toBe('Bookmark');
    });

    it('includes truncated content as description', () => {
      const event = {
        kind: 39701,
        content: 'This is a comment about the bookmarked page',
        tags: [['d', 'example.com']]
      };
      const result = getFeedCardData(event);
      expect(result.description).toBe('This is a comment about the bookmarked page');
    });
  });

  describe('kind 9802 (highlight)', () => {
    it('returns typeKey "highlight" with text excerpt as title', () => {
      const event = {
        kind: 9802,
        content: 'The highlighted text from the page',
        tags: [['r', 'https://example.com/page']]
      };
      const result = getFeedCardData(event);
      expect(result.typeKey).toBe('highlight');
      expect(result.title).toBe('The highlighted text from the page');
    });

    it('truncates long highlight text in title', () => {
      const longText = 'A'.repeat(200);
      const event = {
        kind: 9802,
        content: longText,
        tags: [['r', 'https://example.com']]
      };
      const result = getFeedCardData(event);
      expect(result.title.length).toBeLessThanOrEqual(123); // 120 + '...'
    });

    it('extracts URL from r tag as subtitle', () => {
      const event = {
        kind: 9802,
        content: 'Some highlight',
        tags: [['r', 'https://example.com/page']]
      };
      const result = getFeedCardData(event);
      expect(result.subtitle).toBe('https://example.com/page');
    });

    it('falls back to "Highlight" when no content', () => {
      const event = { kind: 9802, content: '', tags: [] };
      const result = getFeedCardData(event);
      expect(result.typeKey).toBe('highlight');
      expect(result.title).toBe('Highlight');
    });
  });

  describe('kind 1 (text note)', () => {
    it('returns typeKey "note" with content excerpt as title', () => {
      const event = {
        kind: 1,
        content: 'This is a short text note about Nostr.',
        tags: []
      };
      const result = getFeedCardData(event);
      expect(result.typeKey).toBe('note');
      expect(result.title).toBe('This is a short text note about Nostr.');
    });

    it('truncates long content', () => {
      const longContent = 'A'.repeat(200);
      const event = { kind: 1, content: longContent, tags: [] };
      const result = getFeedCardData(event);
      expect(result.title).toBe('A'.repeat(120) + '...');
    });

    it('collapses newlines into spaces', () => {
      const event = {
        kind: 1,
        content: 'First line\n\nSecond line\nThird line',
        tags: []
      };
      const result = getFeedCardData(event);
      expect(result.title).toBe('First line Second line Third line');
    });

    it('falls back to "Note" when content is empty', () => {
      const event = { kind: 1, content: '', tags: [] };
      const result = getFeedCardData(event);
      expect(result.typeKey).toBe('note');
      expect(result.title).toBe('Note');
    });

    it('extracts hashtags', () => {
      const event = {
        kind: 1,
        content: 'Hello #nostr',
        tags: [
          ['t', 'nostr'],
          ['t', 'intro']
        ]
      };
      const result = getFeedCardData(event);
      expect(result.tags).toEqual(['nostr', 'intro']);
    });
  });

  describe('kind 1111 (page note)', () => {
    it('returns typeKey "note" with note excerpt as title', () => {
      const event = {
        kind: 1111,
        content: 'My note about this page',
        tags: [
          ['K', 'web'],
          ['I', 'https://example.com/page']
        ]
      };
      const result = getFeedCardData(event);
      expect(result.typeKey).toBe('note');
      expect(result.title).toBe('My note about this page');
    });

    it('extracts URL from I tag when K=web', () => {
      const event = {
        kind: 1111,
        content: 'A note',
        tags: [
          ['K', 'web'],
          ['I', 'https://example.com/article']
        ]
      };
      const result = getFeedCardData(event);
      expect(result.subtitle).toBe('https://example.com/article');
    });

    it('falls back to r tag when K is not web', () => {
      const event = {
        kind: 1111,
        content: 'A comment',
        tags: [['r', 'https://example.com/fallback']]
      };
      const result = getFeedCardData(event);
      expect(result.subtitle).toBe('https://example.com/fallback');
    });

    it('falls back to "Note" when no content', () => {
      const event = { kind: 1111, content: '', tags: [] };
      const result = getFeedCardData(event);
      expect(result.typeKey).toBe('note');
      expect(result.title).toBe('Note');
    });
  });

  describe('existing kinds still work', () => {
    it('returns article data for kind 30023', () => {
      const event = {
        kind: 30023,
        content: 'Article body',
        tags: [['title', 'My Article']]
      };
      expect(getFeedCardData(event).typeKey).toBe('article');
      expect(getFeedCardData(event).title).toBe('My Article');
    });

    it('returns calendar data for kind 31923', () => {
      const event = {
        kind: 31923,
        content: '',
        tags: [
          ['title', 'Meetup'],
          ['start', '1700000000']
        ]
      };
      expect(getFeedCardData(event).typeKey).toBe('calendar');
    });
  });
});
