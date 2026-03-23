/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import {
  matchHighlights,
  injectHighlightMarks,
  extractContext,
  buildNormToRawMap,
  normalizeWhitespace
} from '$lib/helpers/highlightOverlay.js';

/**
 * Create a fake kind 9802 highlight event.
 * @param {string} text - Highlighted text (goes in content)
 * @param {object} [opts]
 * @param {string} [opts.context] - Context tag value
 * @param {{prefix: string, suffix: string}} [opts.textquoteselector] - W3C TextQuoteSelector prefix/suffix
 * @param {string} [opts.pubkey]
 * @param {string} [opts.id]
 */
function makeHighlight(text, opts = {}) {
  /** @type {string[][]} */
  const tags = [];
  if (opts.context) tags.push(['context', opts.context]);
  if (opts.textquoteselector) {
    tags.push([
      'textquoteselector',
      '-',
      opts.textquoteselector.prefix,
      opts.textquoteselector.suffix
    ]);
  }
  return {
    id: opts.id || Math.random().toString(36).slice(2),
    kind: 9802,
    pubkey: opts.pubkey || 'abc123',
    content: text,
    tags,
    created_at: Math.floor(Date.now() / 1000)
  };
}

describe('matchHighlights', () => {
  it('finds a single highlight in text', () => {
    const article = 'The quick brown fox jumps over the lazy dog.';
    const hl = makeHighlight('brown fox');
    const result = matchHighlights(article, [hl]);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].start).toBe(10);
    expect(result.matched[0].end).toBe(19);
    expect(result.matched[0].events).toEqual([hl]);
    expect(result.unmatched).toHaveLength(0);
  });

  it('finds multiple non-overlapping highlights', () => {
    const article = 'Alpha beta gamma delta epsilon';
    const h1 = makeHighlight('beta');
    const h2 = makeHighlight('delta');
    const result = matchHighlights(article, [h1, h2]);

    expect(result.matched).toHaveLength(2);
    expect(result.matched[0].events).toEqual([h1]);
    expect(result.matched[1].events).toEqual([h2]);
    expect(result.unmatched).toHaveLength(0);
  });

  it('merges overlapping highlights and combines events', () => {
    const article = 'The quick brown fox jumps over the lazy dog.';
    const h1 = makeHighlight('quick brown fox');
    const h2 = makeHighlight('brown fox jumps');
    const result = matchHighlights(article, [h1, h2]);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].events).toHaveLength(2);
    expect(result.matched[0].start).toBe(4); // "quick"
    expect(result.matched[0].end).toBe(25); // end of "jumps"
  });

  it('puts unmatched highlights in unmatched array', () => {
    const article = 'Hello world';
    const h1 = makeHighlight('nonexistent text');
    const result = matchHighlights(article, [h1]);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toEqual([h1]);
  });

  it('uses context tag to disambiguate duplicate text', () => {
    const article =
      'The word test appears here. And in a different paragraph the word test appears again with more context around it.';
    const hl = makeHighlight('test', {
      context: 'different paragraph the word test appears again with more context'
    });
    const result = matchHighlights(article, [hl]);

    expect(result.matched).toHaveLength(1);
    // Should match the second occurrence (near the context)
    expect(result.matched[0].start).toBeGreaterThan(30);
  });

  it('handles empty/null content gracefully', () => {
    expect(matchHighlights('', [makeHighlight('test')])).toEqual({
      matched: [],
      unmatched: [expect.any(Object)]
    });
    expect(matchHighlights('some text', [])).toEqual({ matched: [], unmatched: [] });
    expect(matchHighlights('some text', /** @type {any} */ (null))).toEqual({
      matched: [],
      unmatched: []
    });
  });

  it('uses textquoteselector prefix/suffix to disambiguate when no context tag exists', () => {
    const article =
      'The word test appears here. And in a different paragraph the word test appears again.';
    const hl = makeHighlight('test', {
      textquoteselector: { prefix: 'the word ', suffix: ' appears again' }
    });
    const result = matchHighlights(article, [hl]);

    expect(result.matched).toHaveLength(1);
    // Should match the second occurrence (disambiguated by textquoteselector)
    expect(result.matched[0].start).toBeGreaterThan(30);
  });

  it('prefers context tag over textquoteselector when both present', () => {
    const article =
      'The word test appears here. And in a different paragraph the word test appears again.';
    // context points to the SECOND occurrence, textquoteselector prefix/suffix would point to the FIRST
    const hl = makeHighlight('test', {
      context: 'different paragraph the word test appears again',
      textquoteselector: { prefix: 'The word ', suffix: ' appears here' }
    });
    const result = matchHighlights(article, [hl]);

    expect(result.matched).toHaveLength(1);
    // Should match the second occurrence (context wins over textquoteselector)
    expect(result.matched[0].start).toBeGreaterThan(30);
  });

  it('handles highlight with empty content', () => {
    const hl = makeHighlight('');
    const result = matchHighlights('some article text', [hl]);
    expect(result.unmatched).toEqual([hl]);
  });

  it('normalizes whitespace when matching', () => {
    const article = 'Text with   extra    spaces   in it.';
    const hl = makeHighlight('with extra spaces in');
    const result = matchHighlights(article, [hl]);

    expect(result.matched).toHaveLength(1);
  });
});

describe('buildNormToRawMap', () => {
  it('maps identity for already-normalized text', () => {
    const raw = 'Hello world';
    const map = buildNormToRawMap(raw);
    expect(map[0]).toBe(0); // 'H'
    expect(map[5]).toBe(5); // ' '
    expect(map[6]).toBe(6); // 'w'
    expect(map[11]).toBe(11); // sentinel
  });

  it('handles leading whitespace', () => {
    const raw = '   Hello';
    const map = buildNormToRawMap(raw);
    // normalized = "Hello", raw 'H' is at index 3
    expect(map[0]).toBe(3);
    expect(map[4]).toBe(7); // 'o'
    expect(map[5]).toBe(8); // sentinel
  });

  it('handles trailing whitespace', () => {
    const raw = 'Hello   ';
    const map = buildNormToRawMap(raw);
    // normalized = "Hello"
    expect(map[0]).toBe(0);
    expect(map[4]).toBe(4); // 'o'
    expect(map[5]).toBe(5); // sentinel (past 'o', into trailing ws)
  });

  it('handles collapsed whitespace runs', () => {
    const raw = 'Hello   world';
    const map = buildNormToRawMap(raw);
    // normalized = "Hello world"
    expect(map[0]).toBe(0); // 'H'
    expect(map[5]).toBe(5); // first space of run
    expect(map[6]).toBe(8); // 'w' (after 3-char space run)
    expect(map[10]).toBe(12); // 'd'
    expect(map[11]).toBe(13); // sentinel
  });

  it('handles empty string', () => {
    const map = buildNormToRawMap('');
    expect(map).toHaveLength(1);
    expect(map[0]).toBe(0);
  });

  it('handles newlines and tabs as whitespace', () => {
    const raw = 'First.\n\n\tSecond.';
    const map = buildNormToRawMap(raw);
    const norm = normalizeWhitespace(raw);
    expect(norm).toBe('First. Second.');
    // 'S' in norm is at index 7, in raw it's at index 9
    expect(map[7]).toBe(9);
  });
});

describe('injectHighlightMarks', () => {
  it('wraps correct text in a <mark> element', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>The quick brown fox jumps over the lazy dog.</p>';

    const matches = [{ start: 10, end: 19, events: [makeHighlight('brown fox')] }];
    injectHighlightMarks(container, matches);

    const marks = container.querySelectorAll('mark.reader-highlight');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('brown fox');
  });

  it('handles multiple non-overlapping marks', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Alpha beta gamma delta epsilon</p>';

    const matches = [
      { start: 6, end: 10, events: [makeHighlight('beta')] },
      { start: 17, end: 22, events: [makeHighlight('delta')] }
    ];
    injectHighlightMarks(container, matches);

    const marks = container.querySelectorAll('mark.reader-highlight');
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe('beta');
    expect(marks[1].textContent).toBe('delta');
  });

  it('sets title attribute with author name from profile', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Some highlighted text here.</p>';

    const pubkey = 'a'.repeat(64);
    const event = makeHighlight('highlighted', { pubkey });
    const matches = [{ start: 5, end: 16, events: [event] }];

    const profiles = new Map([
      [
        pubkey,
        {
          kind: 0,
          pubkey,
          id: 'b'.repeat(64),
          sig: 'c'.repeat(128),
          created_at: 0,
          tags: [],
          content: JSON.stringify({ display_name: 'Alice' })
        }
      ]
    ]);

    injectHighlightMarks(container, matches, profiles);

    const mark = container.querySelector('mark');
    expect(mark?.title).toBe('Highlighted by Alice');
  });

  it('sets data-highlight-ids with comma-separated event IDs', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>The quick brown fox jumps over the lazy dog.</p>';

    const e1 = makeHighlight('brown fox', { id: 'event1' });
    const e2 = makeHighlight('brown fox', { id: 'event2' });
    // Simulate merged overlapping match with two events
    const matches = [{ start: 10, end: 19, events: [e1, e2] }];
    injectHighlightMarks(container, matches);

    const mark = /** @type {HTMLElement | null} */ (
      container.querySelector('mark.reader-highlight')
    );
    expect(mark?.dataset.highlightIds).toBe('event1,event2');
  });

  it('sets data-highlight-ids for single event', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Some highlighted text here.</p>';

    const event = makeHighlight('highlighted', { id: 'abc123' });
    const matches = [{ start: 5, end: 16, events: [event] }];
    injectHighlightMarks(container, matches);

    const mark = /** @type {HTMLElement | null} */ (
      container.querySelector('mark.reader-highlight')
    );
    expect(mark?.dataset.highlightIds).toBe('abc123');
  });

  it('handles empty matches gracefully', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Some text</p>';

    // Should not throw
    injectHighlightMarks(container, []);
    expect(container.querySelectorAll('mark')).toHaveLength(0);
  });

  it('handles injection across element boundaries', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Hello <strong>world</strong> today</p>';

    // container.textContent = "Hello world today"
    // "world" is at normalized position 6-11
    const matches = [{ start: 6, end: 11, events: [makeHighlight('world')] }];
    injectHighlightMarks(container, matches);

    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('world');
  });

  it('handles cross-paragraph highlights', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>First paragraph.</p><p>Second paragraph.</p>';

    // container.textContent = "First paragraph.Second paragraph."
    // normalized = "First paragraph.Second paragraph."
    // "Second" starts at index 16 in the raw text
    const containerText = container.textContent || '';
    const normText = normalizeWhitespace(containerText);
    const start = normText.indexOf('Second');
    const end = start + 'Second'.length;

    const matches = [{ start, end, events: [makeHighlight('Second')] }];
    injectHighlightMarks(container, matches);

    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('Second');
  });

  it('integration: matchHighlights + injectHighlightMarks on same container', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>The quick brown fox.</p><p>Jumped over the lazy dog.</p>';

    const containerText = container.textContent || '';
    const hl = makeHighlight('brown fox');
    const { matched } = matchHighlights(containerText, [hl]);

    expect(matched).toHaveLength(1);
    injectHighlightMarks(container, matched);

    const marks = container.querySelectorAll('mark.reader-highlight');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('brown fox');
  });

  it('integration: highlights with whitespace differences between DOM and highlight text', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Some   text   with   spaces.</p>';

    // container.textContent has extra spaces, but matchHighlights normalizes
    const containerText = container.textContent || '';
    const hl = makeHighlight('text with spaces');
    const { matched } = matchHighlights(containerText, [hl]);

    expect(matched).toHaveLength(1);
    injectHighlightMarks(container, matched);

    const marks = container.querySelectorAll('mark.reader-highlight');
    expect(marks).toHaveLength(1);
    // The marked text should contain the original whitespace from the DOM
    expect(normalizeWhitespace(marks[0].textContent || '')).toBe('text with spaces');
  });
});

describe('extractContext', () => {
  const longText =
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';

  it('returns surrounding context for a match', () => {
    const result = extractContext(longText, 'tempor incididunt', 20, 20);
    expect(result).toContain('tempor incididunt');
    // Should have some text before and after
    expect(result.length).toBeGreaterThan('tempor incididunt'.length);
    expect(result.length).toBeLessThanOrEqual('tempor incididunt'.length + 40);
  });

  it('handles selection at the start of text', () => {
    const result = extractContext(longText, 'Lorem ipsum', 100, 20);
    expect(result).toContain('Lorem ipsum');
    expect(result.startsWith('Lorem')).toBe(true);
  });

  it('handles selection at the end of text', () => {
    const result = extractContext(longText, 'commodo consequat.', 20, 100);
    expect(result).toContain('commodo consequat.');
    expect(result.endsWith('consequat.')).toBe(true);
  });

  it('handles no-match gracefully', () => {
    expect(extractContext(longText, 'nonexistent text')).toBe('');
  });

  it('returns empty string for empty inputs', () => {
    expect(extractContext('', 'test')).toBe('');
    expect(extractContext('some text', '')).toBe('');
  });

  it('uses normalized whitespace for matching', () => {
    const text = 'Hello   world   foo   bar';
    const result = extractContext(text, 'world foo', 5, 5);
    expect(result).toContain('world foo');
  });
});
