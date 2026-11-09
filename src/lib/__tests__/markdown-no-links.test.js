/** @vitest-environment jsdom */
/**
 * renderMarkdown({ allowLinks: false }) — Termi's answer bubbles: structure
 * (headings from h3 down, lists, emphasis, quotes, inline code) but no link,
 * image or raw HTML, since tool results can carry prompt-injected markdown.
 */
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '$lib/helpers/markdown.js';

/** @param {string} md */
const dom = (md) => {
  const div = document.createElement('div');
  div.innerHTML = renderMarkdown(md, { allowLinks: false });
  return div;
};

describe('renderMarkdown without links', () => {
  it('renders headings (never h1/h2) and lists; links collapse to their text', () => {
    const div = dom('# Titel\n\n## Teil\n\n- eins\n- [zwei](https://x)\n\n1. **fett** und `code`');
    expect(div.querySelector('h1, h2')).toBeNull();
    expect(div.querySelector('h3')?.textContent).toBe('Titel');
    expect(div.querySelector('h4')?.textContent).toBe('Teil');
    expect([...div.querySelectorAll('ul li')].map((li) => li.textContent)).toEqual([
      'eins',
      'zwei'
    ]);
    expect(div.querySelector('ol strong')?.textContent).toBe('fett');
    expect(div.querySelector('code')?.textContent).toBe('code');
    expect(div.querySelector('a')).toBeNull();
  });

  it('autolinks, images and raw HTML render as text, never as elements', () => {
    const div = dom(
      'Siehe https://evil.example und <https://x.example>\n\n![alt](https://x/p.png)\n\n<img src=x onerror="alert(1)">'
    );
    expect(div.querySelector('a, img')).toBeNull();
    expect(div.querySelector('[onerror]')).toBeNull();
    expect(div.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(div.textContent).toContain('https://evil.example');
    expect(div.textContent).toContain('alt');
  });

  it('partial markdown while streaming does not throw', () => {
    for (const md of ['# Ti', '- eins\n- ', '**fe', '[link](https://x', '```js\nconst', '> zi']) {
      expect(() => dom(md)).not.toThrow();
    }
  });

  it('links stay on by default', () => {
    expect(renderMarkdown('[a](https://x.example)')).toContain('<a href="https://x.example"');
  });
});
