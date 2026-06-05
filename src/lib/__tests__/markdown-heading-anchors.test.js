/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '$lib/helpers/markdown.js';

describe('renderMarkdown with headingAnchors', () => {
  it('emits id and inline anchor on h2 when enabled', () => {
    const html = renderMarkdown('## Hello World', { headingAnchors: true });
    expect(html).toContain('<h2 id="hello-world">');
    expect(html).toContain('href="#hello-world"');
    expect(html).toContain('class="heading-anchor"');
  });

  it('does not emit ids when the option is omitted', () => {
    const html = renderMarkdown('## Hello World');
    expect(html).not.toContain('id="hello-world"');
    expect(html).not.toContain('heading-anchor');
    expect(html).toContain('<h2>Hello World</h2>');
  });

  it('dedupes repeated headings inside the same document', () => {
    const html = renderMarkdown('## Intro\n\n## Intro', { headingAnchors: true });
    expect(html).toContain('id="intro"');
    expect(html).toContain('id="intro-1"');
  });

  it('keeps each render scoped to its own slugger', () => {
    const a = renderMarkdown('## Same', { headingAnchors: true });
    const b = renderMarkdown('## Same', { headingAnchors: true });
    expect(a).toContain('id="same"');
    expect(b).toContain('id="same"');
    expect(a).not.toContain('id="same-1"');
    expect(b).not.toContain('id="same-1"');
  });

  it('renders inline formatting inside headings while slugging the plain text', () => {
    const html = renderMarkdown('## **Bold** Heading', { headingAnchors: true });
    expect(html).toContain('id="bold-heading"');
    expect(html).toContain('<strong>Bold</strong>');
  });

  it('still rewrites nostr: links in body', () => {
    const html = renderMarkdown('See [profile](nostr:npub1abc)', { headingAnchors: true });
    expect(html).toContain('href="/npub1abc"');
  });
});
