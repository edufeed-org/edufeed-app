/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';

// app-settings touches window.matchMedia at module load through transitive
// imports of article-actions; stub before importing.
if (typeof window !== 'undefined' && !window.matchMedia) {
  // @ts-expect-error minimal shim for module-load-time calls
  window.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {}
  });
}

const { buildArticleTags } = await import('../article-actions.svelte.js');

describe('buildArticleTags', () => {
  it('emits ["x", hash] when formData.imageHash is provided', () => {
    const tags = buildArticleTags(
      {
        title: 'Test',
        content: 'body',
        image: 'https://example.com/img.jpg',
        imageHash: 'a'.repeat(64)
      },
      'd-tag-fixed'
    );
    const xTag = tags.find((t) => t[0] === 'x');
    expect(xTag).toEqual(['x', 'a'.repeat(64)]);
  });

  it('omits ["x", ...] when no imageHash', () => {
    const tags = buildArticleTags(
      { title: 'Test', content: 'body', image: 'https://example.com/img.jpg' },
      'd-tag-fixed'
    );
    expect(tags.find((t) => t[0] === 'x')).toBeUndefined();
  });

  it('still emits ["x", ...] even if image is omitted (defensive)', () => {
    const tags = buildArticleTags(
      { title: 'Test', content: 'body', imageHash: 'b'.repeat(64) },
      'd-tag-fixed'
    );
    const xTag = tags.find((t) => t[0] === 'x');
    expect(xTag).toEqual(['x', 'b'.repeat(64)]);
  });
});
