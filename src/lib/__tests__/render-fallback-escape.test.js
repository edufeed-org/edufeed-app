/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { renderMarkdown } from '$lib/helpers/markdown.js';
import { renderWikiContent } from '$lib/helpers/wikiContent.js';

// Both parsers overflow the stack on deep nesting. The error fallback must
// still escape the content: it is untrusted and goes straight into {@html}.
const payload = '<img src=x onerror=alert(1)>';

describe('renderer error fallback', () => {
  it('renderMarkdown escapes the content when marked throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = renderMarkdown('>'.repeat(5000) + 'x\n\n' + payload);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('renderWikiContent escapes the content when djot throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = await renderWikiContent('- '.repeat(2000) + 'x\n\n' + payload);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
