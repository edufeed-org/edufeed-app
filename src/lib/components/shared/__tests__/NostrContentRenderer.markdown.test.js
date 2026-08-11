/**
 * NostrContentRenderer in markdown mode (chat bubbles only).
 *
 * Two things are being defended here:
 *  - the opt-in: seven other callers render notes, comments, DMs and thread
 *    detail through this component, and `ThreadDetailView` explicitly gives
 *    markdown to kind 11 and withholds it from kind 1 / 1111. Markdown must
 *    not reach any of them by default.
 *  - the regression checklist: emoji, mentions, imeta media, galleries and the
 *    lightbox index all have to survive the markdown walk.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock(
  '$lib/components/shared/NostrIdentifier.svelte',
  () => import('./fixtures/NostrIdentifierStub.svelte')
);

vi.mock(
  '$lib/components/shared/MediaLightbox.svelte',
  () => import('./fixtures/MediaLightboxStub.svelte')
);

vi.mock('$lib/helpers/image-proxy.js', () => ({
  getProxiedImageUrl: (/** @type {string} */ url) => url
}));

import NostrContentRenderer from '../NostrContentRenderer.svelte';

const NADDR = 'naddr1' + 'q'.repeat(280);

/** @param {string} content @param {string[][]} [tags] @returns {any} */
const makeEvent = (content, tags = []) => ({
  id: 'e1',
  kind: 9,
  pubkey: 'p'.repeat(64),
  content,
  tags
});

describe('markdown is opt-in', () => {
  it('leaves bold syntax as literal text when the prop is not passed', () => {
    const { container } = render(NostrContentRenderer, { event: makeEvent('**bold**') });

    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toContain('**bold**');
  });

  it('marks up bold when the prop is passed', () => {
    const { container } = render(NostrContentRenderer, {
      event: makeEvent('**bold**'),
      markdown: true
    });

    expect(container.querySelector('strong')?.textContent).toBe('bold');
  });
});

describe('markdown mode renders the shipped subset', () => {
  it('renders italic, strike and inline code', () => {
    const { container } = render(NostrContentRenderer, {
      event: makeEvent('_i_ ~~s~~ `c`'),
      markdown: true
    });

    expect(container.querySelector('em')?.textContent).toBe('i');
    expect(container.querySelector('del')?.textContent).toBe('s');
    expect(container.querySelector('code')?.textContent).toBe('c');
  });

  it('renders a fenced block as a pre, with its content byte-identical', () => {
    const source = 'nostr:npub1abc\n  indented & <kept>';
    const { container } = render(NostrContentRenderer, {
      event: makeEvent('```js\n' + source + '\n```'),
      markdown: true
    });

    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    // Byte-identity, not "no anchor rendered" — the existing markdown path
    // mangles a fenced entity into `[npub…](/npub…)` while emitting no anchor,
    // so an absence-of-anchor assertion passes green on corrupted text.
    expect(pre?.textContent).toBe(source);
  });

  it('renders a blockquote and both list flavours', () => {
    const { container } = render(NostrContentRenderer, {
      event: makeEvent('> q\n\n- a\n- b\n\n1. x'),
      markdown: true
    });

    expect(container.querySelector('blockquote')?.textContent).toContain('q');
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(1);
  });

  it('gives a markdown link the same classes as a plain link', () => {
    // The bubble contrast rule at the bottom of NostrContentRenderer keys on
    // `.link-primary`. A classless anchor is primary-on-primary inside
    // `.chat-bubble-primary` — invisible, and no unit test sees a colour.
    const { container } = render(NostrContentRenderer, {
      event: makeEvent('[label](https://example.com/x)'),
      markdown: true
    });

    const anchor = /** @type {HTMLAnchorElement} */ (container.querySelector('a'));
    expect(anchor.getAttribute('href')).toBe('https://example.com/x');
    expect(anchor.className).toContain('link-primary');
  });

  it('refuses to render a javascript: link as an anchor', () => {
    const { container } = render(NostrContentRenderer, {
      event: makeEvent('[click](javascript:alert(1))'),
      markdown: true
    });

    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('javascript:alert(1)');
  });
});

describe('markdown mode keeps every non-markdown node type', () => {
  it('still renders a NIP-30 custom emoji', () => {
    const { container } = render(NostrContentRenderer, {
      event: makeEvent('hi :zap: there', [['emoji', 'zap', 'https://example.com/zap.png']]),
      markdown: true
    });

    const img = /** @type {HTMLImageElement} */ (container.querySelector('img[alt=":zap:"]'));
    expect(img).not.toBeNull();
  });

  it('still renders a nostr mention as an identifier card', () => {
    const { getByTestId } = render(NostrContentRenderer, {
      event: makeEvent(`hello nostr:${NADDR} bye`),
      markdown: true
    });

    expect(getByTestId('nostr-card').getAttribute('data-identifier')).toBe(NADDR);
  });

  it('still renders a bare image URL as lightbox media, not a markdown link', () => {
    const { getByTestId } = render(NostrContentRenderer, {
      event: makeEvent('look https://example.com/a.png'),
      markdown: true
    });

    expect(getByTestId('media-image')).not.toBeNull();
  });

  it('still groups consecutive image URLs into a gallery', () => {
    const { getByTestId, getAllByTestId } = render(NostrContentRenderer, {
      event: makeEvent(
        'https://example.com/a.png\nhttps://example.com/b.png\nhttps://example.com/c.png'
      ),
      markdown: true
    });

    expect(getByTestId('media-gallery')).not.toBeNull();
    expect(getAllByTestId('media-gallery-item')).toHaveLength(3);
  });

  it('still renders a hashtag', () => {
    const { container } = render(NostrContentRenderer, {
      event: makeEvent('about #peace'),
      markdown: true
    });

    expect(container.textContent).toContain('#peace');
  });

  it('carries imeta alt text onto an image inside a markdown block', () => {
    const { getByTestId } = render(NostrContentRenderer, {
      event: makeEvent('> https://example.com/a.png', [
        ['imeta', 'url https://example.com/a.png', 'alt a peace dove']
      ]),
      markdown: true
    });

    const img = /** @type {HTMLImageElement} */ (getByTestId('media-image').querySelector('img'));
    expect(img.getAttribute('alt')).toBe('a peace dove');
  });

  it('keeps the alt text an author wrote in a markdown image', () => {
    // The image degrades to its bare URL, but the alt the author typed is
    // theirs and there is nothing to gain by dropping it. Raised by TestOER:
    // discarding it is an accessibility regression against nothing, since the
    // brief excluded markdown images from rendering, not authored alt text.
    const { getByTestId } = render(NostrContentRenderer, {
      event: makeEvent('![a helpful caption](https://example.com/a.png)'),
      markdown: true
    });

    const img = /** @type {HTMLImageElement} */ (getByTestId('media-image').querySelector('img'));
    expect(img.getAttribute('alt')).toBe('a helpful caption');
  });

  it('prefers an imeta alt over the markdown one', () => {
    // imeta is the event author's structured metadata and is what every other
    // surface already honours; the markdown alt is the fallback, not a rival.
    const { getByTestId } = render(NostrContentRenderer, {
      event: makeEvent('![typed caption](https://example.com/a.png)', [
        ['imeta', 'url https://example.com/a.png', 'alt imeta caption']
      ]),
      markdown: true
    });

    const img = /** @type {HTMLImageElement} */ (getByTestId('media-image').querySelector('img'));
    expect(img.getAttribute('alt')).toBe('imeta caption');
  });

  it('leaves a bare image URL without an alt', () => {
    // Control: nothing invents alt text where the author supplied none.
    const { getByTestId } = render(NostrContentRenderer, {
      event: makeEvent('https://example.com/a.png'),
      markdown: true
    });

    const img = /** @type {HTMLImageElement} */ (getByTestId('media-image').querySelector('img'));
    expect(img.getAttribute('alt')).toBe('');
  });

  it('keeps a single newline visible as a line break', () => {
    // Markdown mode drops `whitespace-pre-wrap`, so if the break is not
    // emitted explicitly the two lines silently run together.
    const { container } = render(NostrContentRenderer, {
      event: makeEvent('first\nsecond'),
      markdown: true
    });

    expect(container.querySelectorAll('br')).toHaveLength(1);
  });
});

describe('the lightbox index stays global across markdown blocks', () => {
  it('opens on the image that was clicked, not on the first one', async () => {
    // Each block hands `nodeRun` its own offset into the flat node list. Drop
    // the offset and every image in every later block opens image #0.
    const { getAllByTestId, getByTestId } = render(NostrContentRenderer, {
      event: makeEvent('https://example.com/a.png\n\n> https://example.com/b.png'),
      markdown: true
    });

    const buttons = getAllByTestId('media-image');
    expect(buttons).toHaveLength(2);

    buttons[1].click();
    await Promise.resolve();

    const lightbox = getByTestId('lightbox');
    expect(lightbox.getAttribute('data-count')).toBe('2');
    expect(lightbox.getAttribute('data-start-src')).toBe('https://example.com/b.png');
  });
});

describe('tables', () => {
  it('renders a GFM table with its cells, inside a scroll container', async () => {
    const { container } = render(NostrContentRenderer, {
      props: { event: makeEvent('| Spec | Kinds |\n|---|---|\n| NIP-29 | **9** |'), markdown: true }
    });
    const table = container.querySelector('table');
    expect(table).toBeTruthy();
    expect(table?.closest('.overflow-x-auto')).toBeTruthy();
    expect([...container.querySelectorAll('th')].map((el) => el.textContent?.trim())).toEqual([
      'Spec',
      'Kinds'
    ]);
    expect(container.querySelector('td strong')?.textContent).toBe('9');
  });
});
