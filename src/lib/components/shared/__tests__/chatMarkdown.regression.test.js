/**
 * TestOER pre-merge regression checklist for the chat-markdown lane.
 *
 * Built from `a13e244b` BEFORE the feature diff existed, so the expectations
 * come from the pre-change component rather than from the implementation
 * under test. Every case is asserted as PARITY: the same event rendered with
 * `markdown` off and on must produce the same NAST-derived DOM. Markdown may
 * add block structure around the content; it must not drop a node type.
 *
 * The seven node types NostrContentRenderer handled at base:
 *   text (+ nostr-id splitting), emoji (NIP-30), mention, link (image /
 *   video / nostr-URL / plain), hashtag, gallery — plus the cross-node
 *   lightbox index maths.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import NostrContentRenderer from '../NostrContentRenderer.svelte';

// NostrIdentifier is NOT stubbed: the real component renders an observable
// <a href="/p/npub1..."> for both bare mentions and nostr-entity URLs, which
// is a more faithful oracle than a stub that only echoes its props.
vi.mock('$lib/paraglide/messages', () => ({
  media_image_open: () => 'Open image',
  media_video_play: () => 'Play video',
  media_lightbox_close: () => 'Close',
  media_lightbox_prev: () => 'Previous image',
  media_lightbox_next: () => 'Next image'
}));

const IMG = 'https://example.com/photo.jpg';
const IMG2 = 'https://example.com/photo2.jpg';
const IMG3 = 'https://example.com/photo3.jpg';
const IMG4 = 'https://example.com/photo4.jpg';
const IMG5 = 'https://example.com/photo5.jpg';
const VID = 'https://example.com/clip.mp4';
const NPUB = 'npub1r30l8j4vmppvq8w23umcyvd3vct4zmfpfkn4c7h2h057rmlfcrmq9xt9ma';

/** @param {string} content @param {string[][]} [tags] */
const ev = (content, tags = []) => ({
  id: 'a'.repeat(64),
  kind: 9,
  pubkey: 'b'.repeat(64),
  created_at: 1700000000,
  content,
  tags,
  sig: ''
});

/** @param {string} content @param {string[][]} [tags] */
async function renderBoth(content, tags) {
  /** @param {boolean} markdown */
  const once = async (markdown) => {
    const { container } = render(NostrContentRenderer, {
      props: { event: ev(content, tags), markdown }
    });
    await tick();
    await tick();
    return container;
  };
  return { base: await once(false), md: await once(true) };
}

/** Structural census of everything the base component could emit. */
/** @param {Element} c */
function census(c) {
  return {
    images: c.querySelectorAll('[data-testid="media-image"] img').length,
    galleries: c.querySelectorAll('[data-testid="media-gallery"]').length,
    galleryItems: c.querySelectorAll('[data-testid="media-gallery-item"]').length,
    galleryMore: c.querySelector('[data-testid="media-gallery-more"]')?.textContent?.trim() ?? null,
    videos: c.querySelectorAll('video, [data-testid="media-video"]').length,
    identifiers: c.querySelectorAll('a[href^="/p/"], a[href^="/note1"], a[href^="/nevent"]').length,
    emoji: c.querySelectorAll('img[alt^=":"]').length,
    links: c.querySelectorAll('a.link-primary').length,
    hashtags: Array.from(c.querySelectorAll('span.text-primary'))
      .map((e) => e.textContent)
      .join(',')
  };
}

describe('TestOER regression checklist — markdown mode must not drop a node type', () => {
  it('type 1+3: plain text and a bare nostr mention still resolve to an identifier', async () => {
    const { base, md } = await renderBoth(`hello nostr:${NPUB} there`);
    expect(census(md).identifiers).toBe(census(base).identifiers);
    expect(census(md).identifiers).toBeGreaterThan(0);
    expect(md.textContent).toContain('hello');
    expect(md.textContent).toContain('there');
  });

  it('type 2: NIP-30 custom emoji still renders as an image', async () => {
    const tags = [['emoji', 'sob', 'https://example.com/sob.png']];
    const { base, md } = await renderBoth('crying :sob: here', tags);
    expect(census(md).emoji).toBe(census(base).emoji);
    expect(census(md).emoji).toBeGreaterThan(0);
  });

  it('type 4a: a single image still renders with imeta alt and dimensions', async () => {
    const tags = [['imeta', `url ${IMG}`, 'dim 800x600', 'alt a cat']];
    const { base, md } = await renderBoth(`look ${IMG}`, tags);
    expect(census(md).images).toBe(census(base).images);
    expect(census(md).images).toBe(1);
    const img = md.querySelector('[data-testid="media-image"] img');
    expect(img?.getAttribute('alt')).toBe('a cat');
    expect(img?.getAttribute('width')).toBe('800');
    expect(img?.getAttribute('height')).toBe('600');
  });

  it('type 4b: a video URL still renders a video, not a link', async () => {
    const { base, md } = await renderBoth(`clip ${VID}`);
    expect(census(md).videos).toBe(census(base).videos);
    expect(census(md).videos).toBeGreaterThan(0);
  });

  it('type 4c: a nostr entity inside a URL still becomes an embed', async () => {
    const { base, md } = await renderBoth(`https://njump.me/${NPUB}`);
    expect(census(md).identifiers).toBe(census(base).identifiers);
    expect(census(md).identifiers).toBeGreaterThan(0);
  });

  it('type 4d: a bare URL still renders with the link-primary contrast hook', async () => {
    const { base, md } = await renderBoth('see https://example.com/some/page for more');
    expect(census(md).links).toBe(census(base).links);
    expect(census(md).links).toBeGreaterThan(0);
  });

  it('type 4d(ii): a MARKDOWN link carries link-primary too', async () => {
    // A bare URL is handled by applesauce, not the markdown link branch — so
    // asserting only on a bare URL leaves the `[label](href)` anchor untested
    // and a mutation that drops its class survives. Drive that branch directly.
    const { md } = await renderBoth('see [my label](https://example.com/some/page) now');
    const a = md.querySelector('a[href="https://example.com/some/page"]');
    expect(a, 'markdown link did not render an anchor').toBeTruthy();
    expect(a?.textContent).toContain('my label');
    expect(
      a?.classList.contains('link-primary'),
      'markdown anchor lost link-primary — invisible inside .chat-bubble-primary'
    ).toBe(true);
  });

  it('type 5: a hashtag still renders in primary', async () => {
    const { base, md } = await renderBoth('about #nostr today', [['t', 'nostr']]);
    expect(census(md).hashtags).toBe(census(base).hashtags);
    expect(census(md).hashtags).toContain('#nostr');
  });

  it('type 6: a gallery still groups, caps at 4 and shows the +N badge', async () => {
    const { base, md } = await renderBoth(`${IMG}\n${IMG2}\n${IMG3}\n${IMG4}\n${IMG5}`);
    const b = census(base);
    const m = census(md);
    expect(m.galleries).toBe(b.galleries);
    expect(m.galleryItems).toBe(b.galleryItems);
    expect(m.galleryMore).toBe(b.galleryMore);
    expect(m.galleries).toBe(1);
    expect(m.galleryItems).toBe(4);
    expect(m.galleryMore).toBe('+1');
  });

  it('lightbox index maths survives across BLOCKS: a gallery after an image', async () => {
    // A single gallery starts at offset 0, so forcing the offset to 0 is
    // undetectable. Put a standalone image in an earlier block so the
    // gallery's run offset is non-zero, which is what the flat-node-list
    // rework actually changed.
    const { md } = await renderBoth(`first ${IMG}\n\n${IMG2}\n${IMG3}\n${IMG4}`);
    expect(census(md).images).toBe(1);
    const cells = md.querySelectorAll('[data-testid="media-gallery-item"]');
    expect(cells.length).toBe(3);
    // 4 images total; the gallery's first cell is global index 1 -> "2 / 4".
    await fireEvent.click(cells[0]);
    await tick();
    const lb = md.querySelector('[data-testid="media-lightbox"]');
    expect(lb, 'lightbox did not open from a gallery cell').toBeTruthy();
    const c0 = md.querySelector('[data-testid="lightbox-counter"]');
    expect(c0?.textContent?.replace(/\s+/g, ' ').trim()).toBe('2 / 4');
  });

  it('lightbox index maths survives: clicking the 3rd cell of a lone gallery', async () => {
    const { md } = await renderBoth(`${IMG}\n${IMG2}\n${IMG3}\n${IMG4}`);
    const cells = md.querySelectorAll('[data-testid="media-gallery-item"]');
    expect(cells.length).toBe(4);
    await fireEvent.click(cells[2]);
    await tick();
    // The lightbox mounts with the clicked image as its start; the counter
    // renders `{index + 1} / {items.length}`, so cell 2 must read "3 / 4".
    const shown = md.querySelector('[data-testid="media-lightbox"]');
    expect(shown, 'lightbox did not open from a gallery cell').toBeTruthy();
    const counter = md.querySelector('[data-testid="lightbox-counter"]');
    expect(counter?.textContent?.replace(/\s+/g, ' ').trim()).toBe('3 / 4');
  });

  it('lightbox index maths survives TWO galleries in separate blocks', async () => {
    // Fizz's weakest-evidence case: the flat node list assigns each run its
    // own offset, so a second gallery in a later block must not restart at 0.
    const { md } = await renderBoth(`${IMG}\n${IMG2}\n\nmiddle\n\n${IMG3}\n${IMG4}\n${IMG5}`);
    const galleries = md.querySelectorAll('[data-testid="media-gallery"]');
    expect(galleries.length, 'expected two separate galleries').toBe(2);
    const secondCells = galleries[1].querySelectorAll('[data-testid="media-gallery-item"]');
    expect(secondCells.length).toBe(3);
    // 5 images total; the second gallery's first cell is global index 2.
    await fireEvent.click(secondCells[0]);
    await tick();
    const counter = md.querySelector('[data-testid="lightbox-counter"]');
    expect(counter?.textContent?.replace(/\s+/g, ' ').trim()).toBe('3 / 5');
  });

  it('markdown image degrades to its URL — and keeps the author alt text', async () => {
    // TestOER wrote this pinning `alt === ''` and flagged that silently
    // dropping author-written alt text is an accessibility regression against
    // nothing. Taken: the image still degrades to its bare URL (no <img> is
    // ever emitted from markdown), but the alt survives as an imeta fallback.
    const { md } = await renderBoth(`![a helpful caption](${IMG})`);
    expect(census(md).images).toBe(1);
    expect(md.textContent).not.toContain('![');
    const img = md.querySelector('[data-testid="media-image"] img');
    expect(img?.getAttribute('alt')).toBe('a helpful caption');
  });

  it('a mixed message keeps every node type at once', async () => {
    const tags = [
      ['emoji', 'sob', 'https://example.com/sob.png'],
      ['imeta', `url ${IMG}`, 'alt a cat']
    ];
    const { base, md } = await renderBoth(
      `hey nostr:${NPUB} :sob: #tag ${IMG} ${VID} https://example.com/page`,
      tags
    );
    expect(census(md)).toEqual(census(base));
  });
});
