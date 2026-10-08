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

  it('falls back to getSha256FromURL when no imageHash but image URL contains a Blossom hash', () => {
    const blossomHash = 'c'.repeat(64);
    const tags = buildArticleTags(
      {
        title: 'Test',
        content: 'body',
        image: `https://example.com/${blossomHash}.jpg`
      },
      'd-tag-fixed'
    );
    const xTag = tags.find((t) => t[0] === 'x');
    expect(xTag).toEqual(['x', blossomHash]);
  });
});

describe('buildArticleTags — NIP-92 imeta', () => {
  const media = [
    {
      url: 'https://blossom.example/pic.png',
      type: 'image/png',
      sha256: 'c'.repeat(64),
      size: 99,
      dimensions: '800x600',
      alt: 'pic.png'
    }
  ];

  it('writes an imeta tag for each body image still in the content', () => {
    const tags = buildArticleTags(
      { title: 'T', content: 'Text ![pic.png](https://blossom.example/pic.png)', media },
      'd1'
    );
    expect(tags.filter((t) => t[0] === 'imeta')).toEqual([
      [
        'imeta',
        'url https://blossom.example/pic.png',
        'm image/png',
        'x ' + 'c'.repeat(64),
        'size 99',
        'dim 800x600',
        'alt pic.png'
      ]
    ]);
  });

  it('writes no imeta for an image the author removed again, and none without media', () => {
    expect(
      buildArticleTags({ title: 'T', content: 'no image', media }, 'd1').filter(
        (t) => t[0] === 'imeta'
      )
    ).toEqual([]);
    expect(
      buildArticleTags({ title: 'T', content: 'body' }, 'd1').filter((t) => t[0] === 'imeta')
    ).toEqual([]);
  });

  it("on update, carries over the previous version's imeta tags for urls still in the body", () => {
    const previous = ['imeta', 'url https://blossom.example/old.jpg', 'm image/jpeg', 'dim 1x1'];
    const gone = ['imeta', 'url https://blossom.example/gone.jpg', 'm image/jpeg'];
    const tags = buildArticleTags(
      { title: 'T', content: '![](https://blossom.example/old.jpg)' },
      'd1',
      undefined,
      [['d', 'd1'], previous, gone]
    );
    expect(tags.filter((t) => t[0] === 'imeta')).toEqual([previous]);
  });
});
