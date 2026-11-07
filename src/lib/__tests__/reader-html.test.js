/**
 * Reader-mode HTML (third-party pages fetched through /api/reader): headings
 * get ids for the TOC, and the sanitizer is the last thing that touches the
 * markup — re-parsing DOMPurify output and serializing it again is the
 * mutation-XSS pattern.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { renderReaderHtml } from '$lib/helpers/readerHtml.js';

describe('renderReaderHtml', () => {
  it('gives h2/h3 deduped ids', () => {
    const html = renderReaderHtml('<h2>Intro</h2><h3>Intro</h3><h2>Next step!</h2>');
    expect(html).toContain('<h2 id="intro">');
    expect(html).toContain('<h3 id="intro-2">');
    expect(html).toContain('<h2 id="next-step">');
  });

  it('sanitizes the result', () => {
    const html = renderReaderHtml(
      '<h2 onclick="alert(1)">T</h2><img src=x onerror="alert(1)"><script>alert(1)</script><div class="fixed inset-0">x</div>'
    );
    expect(html).not.toMatch(/onclick|onerror|<script|fixed/);
    expect(html).toContain('<h2 id="t">T</h2>');
  });

  it("drops the page's own ids and keeps only the generated heading ids", () => {
    const html = renderReaderHtml('<p id="config">x</p><h2 id="evil">Real</h2>');
    expect(html).toBe('<p>x</p><h2 id="real">Real</h2>');
  });
});
