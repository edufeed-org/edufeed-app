/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { getFeedCardData } from '../helpers/feedCardData.js';

/**
 * Helper to create a minimal Nostr event with the given kind, tags, and optional content.
 * @param {number} kind
 * @param {string[][]} [tags]
 * @param {string} [content]
 */
function makeEvent(kind, tags = [], content = '') {
  return { kind, tags, id: 'test', pubkey: 'test', created_at: 0, content, sig: '' };
}

describe('getFeedCardData', () => {
  // --- Kind 30023: Article ---
  it('extracts title from article (kind 30023) via title tag', () => {
    const result = getFeedCardData(makeEvent(30023, [['title', 'My Article']]));
    expect(result.title).toBe('My Article');
    expect(result.typeKey).toBe('article');
  });

  it('returns fallback title for article when title tag is missing', () => {
    const result = getFeedCardData(makeEvent(30023));
    expect(result.title).toBe('Untitled Article');
  });

  it('extracts summary as description for article', () => {
    const result = getFeedCardData(
      makeEvent(30023, [
        ['title', 'A'],
        ['summary', 'A brief summary']
      ])
    );
    expect(result.description).toBe('A brief summary');
  });

  it('falls back to truncated content for article description', () => {
    const result = getFeedCardData(makeEvent(30023, [['title', 'A']], 'Some article content'));
    expect(result.description).toBe('Some article content');
  });

  // --- Kind 30142: AMB Resource ---
  it('extracts title from AMB resource (kind 30142) via name tag', () => {
    const result = getFeedCardData(makeEvent(30142, [['name', 'Physics 101']]));
    expect(result.title).toBe('Physics 101');
    expect(result.typeKey).toBe('learning');
  });

  it('returns fallback title for AMB resource when name tag is missing', () => {
    const result = getFeedCardData(makeEvent(30142));
    expect(result.title).toBe('Untitled Resource');
  });

  it('extracts learningResourceType label as description for AMB resource', () => {
    const result = getFeedCardData(
      makeEvent(30142, [
        ['name', 'Res'],
        ['learningResourceType', 'https://w3id.org/kim/hcrt/text']
      ])
    );
    expect(result.description).toBe('text');
  });

  it('returns undefined description for AMB resource without learningResourceType', () => {
    const result = getFeedCardData(makeEvent(30142, [['name', 'Res']]));
    expect(result.description).toBeUndefined();
  });

  // --- Kind 30301: Kanban Board ---
  it('extracts title from kanban (kind 30301) via title tag', () => {
    const result = getFeedCardData(makeEvent(30301, [['title', 'Sprint Board']]));
    expect(result.title).toBe('Sprint Board');
    expect(result.typeKey).toBe('board');
  });

  it('falls back to name tag for kanban when title tag is missing', () => {
    const result = getFeedCardData(makeEvent(30301, [['name', 'Board via name']]));
    expect(result.title).toBe('Board via name');
  });

  it('returns fallback title for kanban when both title and name tags are missing', () => {
    const result = getFeedCardData(makeEvent(30301));
    expect(result.title).toBe('Untitled Board');
  });

  it('shows column count as description for kanban', () => {
    const result = getFeedCardData(
      makeEvent(30301, [
        ['title', 'Board'],
        ['col', 'Todo'],
        ['col', 'In Progress'],
        ['col', 'Done']
      ])
    );
    expect(result.description).toBe('3 columns');
  });

  it('returns undefined description for kanban with no columns', () => {
    const result = getFeedCardData(makeEvent(30301, [['title', 'Board']]));
    expect(result.description).toBeUndefined();
  });

  // --- Kind 30818: Wiki ---
  it('extracts title from wiki (kind 30818) via title tag', () => {
    const result = getFeedCardData(makeEvent(30818, [['title', 'Wiki Page']]));
    expect(result.title).toBe('Wiki Page');
    expect(result.typeKey).toBe('wiki');
  });

  it('falls back to d-tag for wiki when title tag is missing', () => {
    const result = getFeedCardData(makeEvent(30818, [['d', 'wiki-slug']]));
    expect(result.title).toBe('wiki-slug');
  });

  it('returns fallback title for wiki when both title and d tags are missing', () => {
    const result = getFeedCardData(makeEvent(30818));
    expect(result.title).toBe('Untitled Wiki');
  });

  it('extracts summary as description for wiki', () => {
    const result = getFeedCardData(
      makeEvent(30818, [
        ['title', 'Wiki'],
        ['summary', 'Wiki summary']
      ])
    );
    expect(result.description).toBe('Wiki summary');
  });

  // --- Kind 31922/31923: Calendar Events ---
  it('extracts title and subtitle from date-based calendar event (kind 31922)', () => {
    const result = getFeedCardData(
      makeEvent(31922, [
        ['title', 'Conference'],
        ['start', '2026-04-01']
      ])
    );
    expect(result).toMatchObject({
      title: 'Conference',
      subtitle: '2026-04-01',
      typeKey: 'calendar'
    });
  });

  it('extracts title and subtitle from time-based calendar event (kind 31923)', () => {
    const result = getFeedCardData(
      makeEvent(31923, [
        ['title', 'Meeting'],
        ['start', '1711929600']
      ])
    );
    expect(result).toMatchObject({
      title: 'Meeting',
      subtitle: '1711929600',
      typeKey: 'calendar'
    });
  });

  it('returns fallback title for calendar event when title tag is missing', () => {
    const result = getFeedCardData(makeEvent(31922, [['start', '2026-04-01']]));
    expect(result.title).toBe('Untitled Event');
    expect(result.subtitle).toBe('2026-04-01');
  });

  it('returns undefined subtitle for calendar event when start tag is missing', () => {
    const result = getFeedCardData(makeEvent(31923, [['title', 'No Date']]));
    expect(result.subtitle).toBeUndefined();
  });

  // --- Kind 11: Thread ---
  it('extracts title from thread (kind 11) via title tag', () => {
    const result = getFeedCardData(makeEvent(11, [['title', 'Discussion Topic']]));
    expect(result.title).toBe('Discussion Topic');
    expect(result.typeKey).toBe('thread');
  });

  it('returns fallback title for thread when title tag is missing', () => {
    const result = getFeedCardData(makeEvent(11));
    expect(result.title).toBe('Untitled Thread');
  });

  it('extracts content excerpt as description for thread', () => {
    const result = getFeedCardData(
      makeEvent(11, [['title', 'Thread']], 'This is the thread content body.')
    );
    expect(result.description).toBe('This is the thread content body.');
  });

  // --- Unknown kind ---
  it('returns fallback title for unknown kind', () => {
    const result = getFeedCardData(makeEvent(9999));
    expect(result.title).toBe('Untitled');
    expect(result.typeKey).toBe('unknown');
  });

  it('returns fallback for kind 1 (text note, not explicitly handled)', () => {
    const result = getFeedCardData(makeEvent(1, [['title', 'Ignored']]));
    expect(result.title).toBe('Untitled');
    expect(result.typeKey).toBe('unknown');
  });

  // --- Tags (universal) ---
  it('extracts first 3 t-tags as tags', () => {
    const result = getFeedCardData(
      makeEvent(30023, [
        ['title', 'A'],
        ['t', 'math'],
        ['t', 'science'],
        ['t', 'education'],
        ['t', 'extra']
      ])
    );
    expect(result.tags).toEqual(['math', 'science', 'education']);
  });

  it('returns empty tags array when no t-tags exist', () => {
    const result = getFeedCardData(makeEvent(30023, [['title', 'A']]));
    expect(result.tags).toEqual([]);
  });

  it('returns tags for unknown kinds too', () => {
    const result = getFeedCardData(makeEvent(9999, [['t', 'misc']]));
    expect(result.tags).toEqual(['misc']);
  });

  // --- Truncation ---
  it('truncates long content to 120 chars with ellipsis', () => {
    const longContent = 'A'.repeat(200);
    const result = getFeedCardData(makeEvent(11, [['title', 'T']], longContent));
    expect(result.description).toBe('A'.repeat(120) + '...');
  });

  it('collapses newlines in content before truncating', () => {
    const result = getFeedCardData(makeEvent(11, [['title', 'T']], 'Line one\n\nLine two'));
    expect(result.description).toBe('Line one Line two');
  });

  it('returns undefined description for empty content', () => {
    const result = getFeedCardData(makeEvent(11, [['title', 'T']], ''));
    expect(result.description).toBeUndefined();
  });
});
