/** @vitest-environment jsdom */
/**
 * renderMarkdown + NIP-92 imeta: body images get width/height from `dim`
 * (no layout shift) and a fallback alt from the tag when the markdown has
 * none. Without an imeta map the output is the plain image.
 */
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '$lib/helpers/markdown.js';
import { imetaByUrl } from '$lib/helpers/imeta.js';

const URL_ = 'https://blossom.example/pic.png';
const tags = [['imeta', `url ${URL_}`, 'm image/png', 'dim 800x600', 'alt A sunny meadow']];

describe('renderMarkdown with imeta', () => {
  it('adds width/height from dim and keeps the markdown alt', () => {
    const html = renderMarkdown(`![Meadow](${URL_})`, { imeta: imetaByUrl(tags) });
    expect(html).toContain(`src="${URL_}"`);
    expect(html).toContain('alt="Meadow"');
    expect(html).toContain('width="800"');
    expect(html).toContain('height="600"');
  });

  it('falls back to the imeta alt when the markdown alt is empty', () => {
    const html = renderMarkdown(`![](${URL_})`, { imeta: imetaByUrl(tags) });
    expect(html).toContain('alt="A sunny meadow"');
  });

  it('matches a tag url that differs only by normalization', () => {
    const map = imetaByUrl([['imeta', 'url HTTPS://Blossom.example/pic.png', 'dim 10x20']]);
    const html = renderMarkdown(`![x](${URL_})`, { imeta: map });
    expect(html).toContain('width="10"');
  });

  it('renders a plain image without an imeta map or for unknown urls', () => {
    expect(renderMarkdown(`![x](${URL_})`)).toContain(`<img src="${URL_}" alt="x">`);
    const html = renderMarkdown('![x](https://other.example/y.png)', { imeta: imetaByUrl(tags) });
    expect(html).not.toContain('width=');
  });

  it('ignores malformed dim values and escapes attribute text', () => {
    const map = imetaByUrl([['imeta', `url ${URL_}`, 'dim wide', 'alt a "quoted" <alt>']]);
    const html = renderMarkdown(`![](${URL_})`, { imeta: map });
    expect(html).not.toContain('width=');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('img')?.getAttribute('alt')).toBe('a "quoted" <alt>');
    // the alt text stayed an attribute value, it did not become markup
    expect(doc.querySelector('alt')).toBeNull();
  });
});
