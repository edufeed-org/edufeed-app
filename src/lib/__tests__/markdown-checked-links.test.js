/** @vitest-environment jsdom */
/** renderMarkdown({ allowLinks: fn }) — Termi's checked links: structure as without links, anchors only where fn says yes. */
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '$lib/helpers/markdown.js';

const ok = (/** @type {string} */ h) => h === '/naddr1ok' || h === 'https://src.org/a';
const dom = (/** @type {string} */ md) => {
  const div = document.createElement('div');
  div.innerHTML = renderMarkdown(md, { allowLinks: ok });
  return div;
};

describe('renderMarkdown with a link check', () => {
  it('an in-app target stays in the tab, an external one opens a new tab safely', () => {
    const a = dom('[A](/naddr1ok) [S](https://src.org/a)').querySelectorAll('a');
    expect(a[0].getAttribute('href')).toBe('/naddr1ok');
    expect(a[0].hasAttribute('target')).toBe(false);
    expect(a[1].getAttribute('target')).toBe('_blank');
    expect(a[1].getAttribute('rel')).toBe('noopener noreferrer');
  });
  it('unchecked targets, bare urls, autolinks, images and raw html give no element', () => {
    const div = dom(
      '[t](https://evil.example) [j](javascript:alert(1)) https://evil.example www.evil.example <https://evil.example> ![i](https://src.org/a) <a href="https://src.org/a">raw</a>'
    );
    expect(div.querySelector('a, img')).toBeNull();
    expect(div.textContent).toContain('https://evil.example');
  });
  it('a bare url that is allowed becomes a link', () => {
    expect(dom('siehe https://src.org/a').querySelector('a')?.getAttribute('href')).toBe(
      'https://src.org/a'
    );
  });
  it('keeps the text-only structure: headings from h3', () => {
    expect(dom('# T').querySelector('h3')?.textContent).toBe('T');
  });
});
