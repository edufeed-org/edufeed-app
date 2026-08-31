/**
 * TestOER probe of the alt-text decision at 4f5c2a51.
 *
 * Two things to establish independently of the author's own tests:
 *  1. precedence — imeta must beat the markdown caption, and a bare URL must
 *     get no alt at all (nothing invented where the author supplied nothing);
 *  2. the in-place tagging is claimed safe because the nodes were parsed with
 *     a null cache key. This file attacks that claim: if `mdAlt` leaks, an
 *     unrelated message showing the SAME url would inherit someone else's
 *     caption.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import NostrContentRenderer from '../NostrContentRenderer.svelte';

vi.mock('$lib/paraglide/messages', () => ({
  media_image_open: () => 'Open image',
  media_video_play: () => 'Play video',
  media_lightbox_close: () => 'Close',
  media_lightbox_prev: () => 'Previous image',
  media_lightbox_next: () => 'Next image'
}));

const IMG = 'https://example.com/photo.jpg';

/** @param {string} content @param {string[][]} [tags] @param {string} [id] */
const ev = (content, tags = [], id = 'a'.repeat(64)) => ({
  id,
  kind: 9,
  pubkey: 'b'.repeat(64),
  created_at: 1700000000,
  content,
  tags,
  sig: ''
});

/** @param {any} event */
async function altOf(event) {
  const { container } = render(NostrContentRenderer, { props: { event, markdown: true } });
  await tick();
  await tick();
  return container.querySelector('[data-testid="media-image"] img')?.getAttribute('alt');
}

describe('alt precedence', () => {
  it('markdown caption is used when there is no imeta', async () => {
    expect(await altOf(ev(`![a helpful caption](${IMG})`))).toBe('a helpful caption');
  });

  it('imeta wins over the markdown caption', async () => {
    const tags = [['imeta', `url ${IMG}`, 'alt structured alt']];
    expect(await altOf(ev(`![a helpful caption](${IMG})`, tags))).toBe('structured alt');
  });

  it('a bare image URL invents nothing', async () => {
    expect(await altOf(ev(`look ${IMG}`))).toBe('');
  });
});

describe('the in-place tagging must not leak across messages', () => {
  it('a later message with the same URL does not inherit the caption', async () => {
    // Render the captioned one first so any shared/cached node is tagged.
    expect(await altOf(ev(`![someone elses caption](${IMG})`, [], 'c'.repeat(64)))).toBe(
      'someone elses caption'
    );
    // A DIFFERENT event, same url, no caption. Must not pick up the tag.
    const leaked = await altOf(ev(`look ${IMG}`, [], 'd'.repeat(64)));
    expect(leaked, `mdAlt leaked across events: got ${JSON.stringify(leaked)}`).toBe('');
  });

  it('re-rendering the SAME event twice is stable', async () => {
    const e = ev(`![stable caption](${IMG})`, [], 'e'.repeat(64));
    expect(await altOf(e)).toBe('stable caption');
    expect(await altOf(e)).toBe('stable caption');
  });

  it('a markdown caption does not bleed into a bare URL in the same message', async () => {
    const alt = await altOf(ev(`![the caption](${IMG})\n\nand also https://example.com/other.jpg`));
    // first image keeps its caption
    expect(alt).toBe('the caption');
    const { container } = render(NostrContentRenderer, {
      props: {
        event: ev(`![the caption](${IMG})\n\nand also https://example.com/other.jpg`),
        markdown: true
      }
    });
    await tick();
    await tick();
    const imgs = container.querySelectorAll('[data-testid="media-image"] img');
    expect(imgs.length).toBe(2);
    expect(imgs[1].getAttribute('alt'), 'second, uncaptioned image inherited an alt').toBe('');
  });
});
