/**
 * LinkPreview — the OG thumbnail must never be loaded straight from the
 * linked site. Loading it directly would hand every viewer's IP address and
 * user agent to a third party (e.g. i.ytimg.com for YouTube links) before any
 * click and without consent; the privacy policy promises that preview images
 * are fetched by our server. The card therefore always goes through
 * /api/image and never falls back to the original URL.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/svelte';
import LinkPreview from '../shared/LinkPreview.svelte';

vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: { linkPreviewsEnabled: true }
}));

const PAGE_URL = 'https://www.youtube.com/watch?v=xwF08pXuTJQ';
const THUMB_URL = 'https://i.ytimg.com/vi/xwF08pXuTJQ/maxresdefault.jpg';

/**
 * Hosts the rendered DOM would make the browser contact: every src/href
 * resolved against the app origin. The proxy URL carries the third-party URL
 * only inside its query string, so it resolves to localhost.
 * @param {HTMLElement} container
 */
function contactedHosts(container) {
  return [...container.querySelectorAll('[src], [href]')].map((el) => {
    const raw = el.getAttribute('src') ?? el.getAttribute('href') ?? '';
    return new URL(raw, 'http://localhost').host;
  });
}

/** @param {object} metadata */
function mockMetadataFetch(metadata) {
  const fetchMock = vi.fn(async () => ({
    json: async () => ({ success: true, metadata })
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('LinkPreview thumbnail', () => {
  beforeEach(() => {
    mockMetadataFetch({
      source: 'opengraph',
      og: {
        title: 'Websites Are Dead. Build THIS Instead',
        description: 'AI made websites easier to build.',
        image: THUMB_URL,
        siteName: 'YouTube'
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the OG image through the image proxy, never from the third-party host', async () => {
    const { getByTestId, container } = render(LinkPreview, { props: { url: PAGE_URL } });

    await waitFor(() => expect(getByTestId('link-preview-card')).toBeTruthy());

    const img = /** @type {HTMLImageElement} */ (container.querySelector('img'));
    expect(img).toBeTruthy();
    const src = img.getAttribute('src') ?? '';
    expect(src.startsWith('/api/image?')).toBe(true);
    expect(new URL(src, 'http://localhost').searchParams.get('url')).toBe(THUMB_URL);

    // The only outbound reference is the link itself; the image host is never contacted.
    expect(contactedHosts(container)).not.toContain('i.ytimg.com');
  });

  it('drops the thumbnail instead of retrying the original URL when the proxy fails', async () => {
    const { getByTestId, container, queryByTestId } = render(LinkPreview, {
      props: { url: PAGE_URL }
    });

    await waitFor(() => expect(getByTestId('link-preview-thumb')).toBeTruthy());
    const img = /** @type {HTMLImageElement} */ (container.querySelector('img'));
    await fireEvent.error(img);

    await waitFor(() => expect(queryByTestId('link-preview-thumb')).toBeNull());
    expect(contactedHosts(container)).not.toContain('i.ytimg.com');
    // The card itself survives without the image.
    expect(getByTestId('link-preview-title').textContent).toContain('Websites Are Dead');
  });

  it('still asks the reader endpoint for metadata, not the linked page', async () => {
    render(LinkPreview, { props: { url: PAGE_URL } });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const calledWith = String(/** @type {any} */ (globalThis.fetch).mock.calls[0][0]);
    expect(calledWith.startsWith('/api/reader?mode=metadata&url=')).toBe(true);
  });
});
