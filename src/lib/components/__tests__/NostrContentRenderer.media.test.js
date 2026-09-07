/**
 * Media rendering rules in feed post content (design handoff):
 * - single images left-aligned at natural size, max-height 480px, no fill box
 * - 2–4 images in an X-style grid (340px, cover-cropped cells)
 * - video: poster + play overlay + duration badge, click-to-play inline
 * - lightbox with keyboard nav, counter, wrap-around
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import NostrContentRenderer from '../shared/NostrContentRenderer.svelte';

function StubComponent() {}
vi.mock('../shared/NostrIdentifier.svelte', () => ({ default: StubComponent }));

vi.mock('$lib/paraglide/messages', () => ({
  media_image_open: () => 'Open image',
  media_video_play: () => 'Play video',
  media_lightbox_close: () => 'Close',
  media_lightbox_prev: () => 'Previous image',
  media_lightbox_next: () => 'Next image'
}));

/**
 * @param {string} content
 * @param {string[][]} [tags]
 */
function noteEvent(content, tags = []) {
  return {
    id: 'a'.repeat(64),
    kind: 1,
    pubkey: 'b'.repeat(64),
    created_at: 1700000000,
    content,
    tags,
    sig: ''
  };
}

/**
 * querySelector that throws instead of returning null (keeps fireEvent typed).
 * @param {Element} root
 * @param {string} selector
 * @returns {Element}
 */
function q(root, selector) {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  return el;
}

/**
 * @param {string} content
 * @param {string[][]} [tags]
 */
async function renderContent(content, tags) {
  const utils = render(NostrContentRenderer, { props: { event: noteEvent(content, tags) } });
  await tick();
  return utils;
}

describe('single image', () => {
  it('renders left-aligned at natural size without a background fill box', async () => {
    const { container } = await renderContent('look at this https://example.com/photo.jpg');

    const img = container.querySelector('[data-testid="media-image"] img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('loading')).toBe('lazy');
    // natural-size constraints, 12px radius
    expect(img?.className).toContain('max-h-[480px]');
    expect(img?.className).toContain('max-w-full');
    expect(img?.className).toContain('rounded-xl');
    // the old letterbox treatment is gone: no fill-box WRAPPER around the img.
    // (The img itself may carry a transient bg-base-200 skeleton tone while
    // loading — added by ImageWithFallback — which never resolves in jsdom.)
    expect(img?.className).not.toContain('object-contain');
    expect(container.querySelector('div.bg-base-200')).toBeFalsy();
    expect(container.querySelector('.aspect-video')).toBeFalsy();
  });

  it('sets width/height attributes and alt from imeta metadata', async () => {
    const { container } = await renderContent('https://example.com/photo.jpg', [
      ['imeta', 'url https://example.com/photo.jpg', 'dim 800x1066', 'alt Schulgarten']
    ]);

    const img = container.querySelector('[data-testid="media-image"] img');
    expect(img?.getAttribute('width')).toBe('800');
    expect(img?.getAttribute('height')).toBe('1066');
    expect(img?.getAttribute('alt')).toBe('Schulgarten');
  });

  it('opens the lightbox with the original (unproxied) image and no counter', async () => {
    const { container } = await renderContent('https://example.com/photo.jpg');

    const feedImg = container.querySelector('[data-testid="media-image"] img');
    expect(feedImg?.getAttribute('src')).toContain('/api/image?');

    await fireEvent.click(q(container, '[data-testid="media-image"]'));
    const lightboxImg = container.querySelector('[data-testid="lightbox-image"]');
    expect(lightboxImg).toBeTruthy();
    expect(lightboxImg?.getAttribute('src')).toBe('https://example.com/photo.jpg');
    expect(container.querySelector('[data-testid="lightbox-counter"]')).toBeFalsy();
  });
});

describe('lightbox behavior', () => {
  it('closes on Escape', async () => {
    const { container } = await renderContent('https://example.com/photo.jpg');
    await fireEvent.click(q(container, '[data-testid="media-image"]'));
    expect(container.querySelector('[data-testid="media-lightbox"]')).toBeTruthy();

    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('[data-testid="media-lightbox"]')).toBeFalsy();
  });

  it('closes on backdrop click but not when clicking the image itself', async () => {
    const { container } = await renderContent('https://example.com/photo.jpg');
    await fireEvent.click(q(container, '[data-testid="media-image"]'));

    await fireEvent.click(q(container, '[data-testid="lightbox-image"]'));
    expect(container.querySelector('[data-testid="media-lightbox"]')).toBeTruthy();

    await fireEvent.click(q(container, '[data-testid="media-lightbox"]'));
    expect(container.querySelector('[data-testid="media-lightbox"]')).toBeFalsy();
  });

  it('closes via the close button', async () => {
    const { container } = await renderContent('https://example.com/photo.jpg');
    await fireEvent.click(q(container, '[data-testid="media-image"]'));

    await fireEvent.click(q(container, '[data-testid="lightbox-close"]'));
    expect(container.querySelector('[data-testid="media-lightbox"]')).toBeFalsy();
  });

  it('does not let media or backdrop clicks bubble into a click-to-navigate host card', async () => {
    const { default: Fixture } = await import('./fixtures/MediaClickCaptureFixture.svelte');
    const onouterclick = vi.fn();
    const { container } = render(Fixture, {
      props: { event: noteEvent('https://example.com/photo.jpg'), onouterclick }
    });
    await tick();

    await fireEvent.click(q(container, '[data-testid="media-image"]'));
    expect(container.querySelector('[data-testid="media-lightbox"]')).toBeTruthy();

    await fireEvent.click(q(container, '[data-testid="media-lightbox"]'));
    expect(container.querySelector('[data-testid="media-lightbox"]')).toBeFalsy();
    expect(onouterclick).not.toHaveBeenCalled();
  });
});

describe('image grid (2–4 images)', () => {
  const three = [
    'https://example.com/one.jpg',
    'https://example.com/two.jpg',
    'https://example.com/three.jpg'
  ].join('\n');

  it('renders 3 images as a 2-column grid with the first image spanning both rows', async () => {
    const { container } = await renderContent(three);

    const grid = container.querySelector('[data-testid="media-gallery"]');
    expect(grid).toBeTruthy();
    expect(grid?.className).toContain('grid-cols-2');
    expect(grid?.className).toContain('h-[340px]');
    expect(grid?.className).toContain('gap-1.5');
    expect(grid?.className).toContain('rounded-xl');
    expect(grid?.className).toContain('overflow-hidden');

    const items = container.querySelectorAll('[data-testid="media-gallery-item"]');
    expect(items.length).toBe(3);
    expect(items[0].className).toContain('row-span-2');
    expect(items[1].className).not.toContain('row-span-2');

    for (const img of grid?.querySelectorAll('img') ?? []) {
      expect(img.className).toContain('object-cover');
    }
  });

  it('opens the lightbox at the clicked index with counter and wrap-around arrow navigation', async () => {
    const { container } = await renderContent(three);

    const items = container.querySelectorAll('[data-testid="media-gallery-item"]');
    await fireEvent.click(items[1]);

    const counter = () => container.querySelector('[data-testid="lightbox-counter"]')?.textContent;
    expect(counter()).toBe('2 / 3');
    expect(container.querySelector('[data-testid="lightbox-image"]')?.getAttribute('src')).toBe(
      'https://example.com/two.jpg'
    );

    await fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(counter()).toBe('3 / 3');
    await fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(counter()).toBe('1 / 3');
    await fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(counter()).toBe('3 / 3');
  });

  it('navigates via the prev/next buttons', async () => {
    const { container } = await renderContent(three);
    await fireEvent.click(container.querySelectorAll('[data-testid="media-gallery-item"]')[0]);

    await fireEvent.click(q(container, '[data-testid="lightbox-next"]'));
    expect(container.querySelector('[data-testid="lightbox-counter"]')?.textContent).toBe('2 / 3');
    await fireEvent.click(q(container, '[data-testid="lightbox-prev"]'));
    expect(container.querySelector('[data-testid="lightbox-counter"]')?.textContent).toBe('1 / 3');
  });

  it('shows only 4 tiles for 5+ images, with a "+N" overlay, but all images in the lightbox', async () => {
    const six = Array.from({ length: 6 }, (_, i) => `https://example.com/pic${i}.jpg`).join('\n');
    const { container } = await renderContent(six);

    const items = container.querySelectorAll('[data-testid="media-gallery-item"]');
    expect(items.length).toBe(4);
    expect(container.querySelector('[data-testid="media-gallery-more"]')?.textContent).toBe('+2');

    await fireEvent.click(items[0]);
    expect(container.querySelector('[data-testid="lightbox-counter"]')?.textContent).toBe('1 / 6');
  });
});

describe('multiple separate images', () => {
  it('collects all images of the post into one lightbox collection', async () => {
    const { container } = await renderContent(
      'first https://example.com/one.jpg and later https://example.com/two.jpg done'
    );

    const buttons = container.querySelectorAll('[data-testid="media-image"]');
    expect(buttons.length).toBe(2);

    await fireEvent.click(buttons[1]);
    expect(container.querySelector('[data-testid="lightbox-counter"]')?.textContent).toBe('2 / 2');
  });
});

describe('video', () => {
  it('shows a poster from imeta with a play overlay instead of native controls', async () => {
    const { container } = await renderContent('https://example.com/clip.mp4', [
      ['imeta', 'url https://example.com/clip.mp4', 'image https://example.com/poster.jpg']
    ]);

    const wrapper = container.querySelector('[data-testid="media-video"]');
    expect(wrapper).toBeTruthy();
    expect(container.querySelector('[data-testid="media-video-play"]')).toBeTruthy();

    const video = wrapper?.querySelector('video');
    expect(video).toBeTruthy();
    expect(video?.hasAttribute('controls')).toBe(false);
    expect(video?.getAttribute('preload')).toBe('metadata');
    expect(video?.getAttribute('poster')).toContain('poster');
    // no letterbox fill box
    expect(container.querySelector('.bg-base-200')).toBeFalsy();
    expect(container.querySelector('.aspect-video')).toBeFalsy();
  });

  it('swaps in a playing native player on click', async () => {
    const { container } = await renderContent('https://example.com/clip.mp4');

    await fireEvent.click(q(container, '[data-testid="media-video-play"]'));

    const player = container.querySelector('[data-testid="media-video-player"]');
    expect(player).toBeTruthy();
    expect(player?.hasAttribute('controls')).toBe(true);
    expect(/** @type {HTMLVideoElement} */ (player)?.autoplay).toBe(true);
    expect(player?.getAttribute('src')).toBe('https://example.com/clip.mp4');
    // the poster state is gone
    expect(container.querySelector('[data-testid="media-video-play"]')).toBeFalsy();
    // clicking play never opens the lightbox
    expect(container.querySelector('[data-testid="media-lightbox"]')).toBeFalsy();
  });

  it('shows a duration badge once video metadata is known', async () => {
    const { container } = await renderContent('https://example.com/clip.mp4');

    expect(container.querySelector('[data-testid="media-video-duration"]')).toBeFalsy();

    const video = q(container, '[data-testid="media-video"] video');
    Object.defineProperty(video, 'duration', { value: 124, configurable: true });
    await fireEvent(video, new Event('loadedmetadata'));
    await waitFor(() => {
      expect(container.querySelector('[data-testid="media-video-duration"]')?.textContent).toBe(
        '2:04'
      );
    });
  });
});

// Chat uploads (ours and Armada's) declare the MIME in a NIP-92 imeta tag;
// content-addressed Blossom URLs may have no extension, so detection must
// also read the imeta. Non-media attachments become a download file card.
describe('imeta-declared attachments', () => {
  const bareUrl = 'https://blossom.example/' + 'c'.repeat(64);

  it('renders an extension-less URL with an image imeta MIME as an inline image', async () => {
    const { container } = await renderContent(bareUrl, [
      ['imeta', `url ${bareUrl}`, 'm image/png']
    ]);
    // src goes through the /api/image proxy — assert the original URL rides inside
    const src = q(container, '[data-testid="media-image"] img').getAttribute('src') ?? '';
    expect(decodeURIComponent(src)).toContain(bareUrl);
  });

  it('renders an extension-less URL with a video imeta MIME as an inline video', async () => {
    const { container } = await renderContent(bareUrl, [
      ['imeta', `url ${bareUrl}`, 'm video/mp4']
    ]);
    expect(container.querySelector('[data-testid="media-video"]')).toBeTruthy();
  });

  it('renders a URL with a non-media imeta as a download file card', async () => {
    const url = 'https://blossom.example/' + 'c'.repeat(64) + '.pdf';
    const { container } = await renderContent(`here you go ${url}`, [
      ['imeta', `url ${url}`, 'm application/pdf', 'size 2048', 'name worksheet.pdf']
    ]);
    const card = q(container, '[data-testid="file-attachment-card"]');
    expect(card.getAttribute('href')).toBe(url);
    expect(card.textContent).toContain('worksheet.pdf');
    expect(card.textContent).toContain('2.0 KB');
  });

  it('leaves a pasted non-media URL without imeta as a plain link', async () => {
    const { container } = await renderContent('read https://example.com/paper.pdf');
    expect(container.querySelector('[data-testid="file-attachment-card"]')).toBeFalsy();
    expect(container.querySelector('a.link')).toBeTruthy();
  });

  it('does not turn a webxdc share into a file card (its launch card renders elsewhere)', async () => {
    const url = 'https://blossom.example/pad.xdc';
    const { container } = await renderContent(url, [
      ['imeta', `url ${url}`, 'm application/x-webxdc', 'webxdc session-1']
    ]);
    expect(container.querySelector('[data-testid="file-attachment-card"]')).toBeFalsy();
  });
});
