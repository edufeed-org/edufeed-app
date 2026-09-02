/** @vitest-environment jsdom */
/**
 * message-anchor — deep-link plumbing for chat messages: build a shareable
 * URL for a message inside a channel, and scroll/flash the matching row.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildMessageDeepLink, scrollToChatMessage } from '$lib/helpers/message-anchor.js';

describe('buildMessageDeepLink', () => {
  const loc = { origin: 'https://app.example', pathname: '/c/npub1xyz', search: '?view=channels' };

  it('appends channel and message to the current URL, keeping other params', () => {
    expect(buildMessageDeepLink(loc, 'chan1', 'a'.repeat(64))).toBe(
      `https://app.example/c/npub1xyz?view=channels&channel=chan1&message=${'a'.repeat(64)}`
    );
  });

  it('overwrites a stale channel/message pair instead of duplicating it', () => {
    const url = buildMessageDeepLink(
      { ...loc, search: '?view=channels&channel=old&message=stale' },
      'chan2',
      'b'.repeat(64)
    );
    const params = new URL(url).searchParams;
    expect(params.getAll('channel')).toEqual(['chan2']);
    expect(params.getAll('message')).toEqual(['b'.repeat(64)]);
  });

  it('works from a bare path with no query string', () => {
    expect(buildMessageDeepLink({ ...loc, search: '' }, 'chan1', 'msg1')).toBe(
      'https://app.example/c/npub1xyz?channel=chan1&message=msg1'
    );
  });
});

describe('scrollToChatMessage', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  /** @param {string} id */
  function mountRow(id) {
    const el = document.createElement('div');
    el.setAttribute('data-message-id', id);
    document.body.appendChild(el);
    return el;
  }

  it('returns false and leaves the DOM alone when the row is absent', () => {
    expect(scrollToChatMessage(document, 'missing')).toBe(false);
  });

  it('scrolls the row into view and flashes the highlight class', () => {
    vi.useFakeTimers();
    const el = mountRow('m1');
    const scrollSpy = vi.fn();
    /** @type {any} */ (el).scrollIntoView = scrollSpy;

    expect(scrollToChatMessage(document, 'm1', { highlightMs: 500 })).toBe(true);
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(el.classList.contains('chat-message-highlight')).toBe(true);
    vi.advanceTimersByTime(500);
    expect(el.classList.contains('chat-message-highlight')).toBe(false);
  });

  it('still highlights in environments without scrollIntoView (jsdom)', () => {
    const el = mountRow('m2');
    // jsdom elements genuinely lack scrollIntoView — no stub here on purpose.
    expect(scrollToChatMessage(document, 'm2')).toBe(true);
    expect(el.classList.contains('chat-message-highlight')).toBe(true);
  });

  it('tolerates ids that would break a raw CSS selector', () => {
    expect(() => scrollToChatMessage(document, 'a"] , [x="b')).not.toThrow();
    expect(scrollToChatMessage(document, 'a"] , [x="b')).toBe(false);
  });
});
