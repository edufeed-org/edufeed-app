/**
 * LinkPreview component tests.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';

// vi.mock is hoisted to the top of the file, so we cannot reference a `const`
// declared below it. Using a module-level object returned directly from the
// factory avoids the TDZ error; we then mutate it in beforeEach/tests.
vi.mock('$lib/stores/app-settings.svelte.js', () => {
  const appSettings = { linkPreviewsEnabled: true };
  return { appSettings };
});

// Import the mocked module so tests can mutate appSettings directly.
import { appSettings as appSettingsMock } from '$lib/stores/app-settings.svelte.js';

import LinkPreview from '../LinkPreview.svelte';

/** @param {{ success: boolean, metadata?: any }} body */
function mockFetchOnce(body) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(body)
    })
  );
}

function mockFetchReject() {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network')));
}

function mockFetchPending() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})) // never resolves
  );
}

beforeEach(() => {
  appSettingsMock.linkPreviewsEnabled = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LinkPreview', () => {
  it('renders nothing when linkPreviewsEnabled is false', () => {
    appSettingsMock.linkPreviewsEnabled = false;
    mockFetchPending(); // would render skeleton if it got past the gate
    const { container } = render(LinkPreview, { props: { url: 'https://x.test' } });
    expect(container.querySelector('[data-testid="link-preview-skeleton"]')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders the skeleton while fetch is in flight', () => {
    mockFetchPending();
    const { container } = render(LinkPreview, { props: { url: 'https://x.test' } });
    expect(container.querySelector('[data-testid="link-preview-skeleton"]')).not.toBeNull();
  });

  it('renders a horizontal card with a 150px cover thumbnail when metadata.image is present', async () => {
    mockFetchOnce({
      success: true,
      metadata: {
        source: 'opengraph',
        og: {
          title: 'Hello World',
          description: 'A short description',
          image: 'https://x.test/cover.png',
          siteName: 'X Test'
        }
      }
    });
    const { container } = render(LinkPreview, { props: { url: 'https://x.test/page' } });
    const card = await waitFor(() => {
      const el = container.querySelector('[data-testid="link-preview-card"]');
      expect(el).not.toBeNull();
      return el;
    });

    // horizontal card: thumbnail left, meta right (design handoff rule 4)
    expect(card?.className).toContain('flex');
    expect(card?.className).not.toContain('flex-col');
    expect(card?.className).toContain('rounded-xl');
    expect(card?.className).toContain('overflow-hidden');
    expect(card?.className).toContain('border');

    const thumb = card?.querySelector('[data-testid="link-preview-thumb"]');
    expect(thumb).not.toBeNull();
    expect(thumb?.className).toContain('w-[150px]');
    expect(thumb?.querySelector('img')?.className).toContain('object-cover');

    expect(container.textContent).toContain('Hello World');
    expect(container.textContent).toContain('A short description');
  });

  it('stacks domain (mono) → title → clamped description in the meta column', async () => {
    mockFetchOnce({
      success: true,
      metadata: {
        source: 'opengraph',
        og: {
          title: 'Hello World',
          description: 'A short description',
          image: 'https://x.test/cover.png'
        }
      }
    });
    const { container } = render(LinkPreview, { props: { url: 'https://x.test/page' } });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="link-preview-card"]')).not.toBeNull();
    });

    const domain = container.querySelector('[data-testid="link-preview-domain"]');
    expect(domain?.textContent).toBe('x.test');
    expect(domain?.className).toContain('font-mono');

    const title = container.querySelector('[data-testid="link-preview-title"]');
    expect(title?.textContent).toBe('Hello World');
    expect(title?.className).toContain('font-semibold');

    const desc = container.querySelector('[data-testid="link-preview-description"]');
    expect(desc?.className).toContain('line-clamp-2');
  });

  it('renders the card without a thumbnail when image is missing but title is present', async () => {
    mockFetchOnce({
      success: true,
      metadata: { source: 'opengraph', og: { title: 'Hello', siteName: 'X Test' } }
    });
    const { container } = render(LinkPreview, { props: { url: 'https://x.test/page' } });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="link-preview-card"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-testid="link-preview-thumb"]')).toBeNull();
    expect(container.textContent).toContain('Hello');
  });

  it('renders nothing when metadata source is "none" (no usable fields)', async () => {
    mockFetchOnce({
      success: true,
      metadata: { source: 'none' }
    });
    const { container } = render(LinkPreview, { props: { url: 'https://example.test/page' } });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="link-preview-skeleton"]')).toBeNull();
      expect(container.querySelector('a')).toBeNull();
    });
  });

  it('shows the domain when only siteName is present (no duplicate hostname)', async () => {
    mockFetchOnce({
      success: true,
      metadata: { source: 'opengraph', og: { siteName: 'X Test' } }
    });
    const { container } = render(LinkPreview, { props: { url: 'https://example.test/page' } });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="link-preview-card"]')).not.toBeNull();
    });
    expect(container.textContent).toContain('example.test');
    // Hostname must appear exactly once.
    const matches = container.textContent?.match(/example\.test/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('renders nothing when fetch returns success: false', async () => {
    mockFetchOnce({ success: false });
    const { container } = render(LinkPreview, { props: { url: 'https://x.test/page' } });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="link-preview-skeleton"]')).toBeNull();
      expect(container.querySelector('a')).toBeNull();
    });
  });

  it('renders nothing when fetch throws', async () => {
    mockFetchReject();
    const { container } = render(LinkPreview, { props: { url: 'https://x.test/page' } });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="link-preview-skeleton"]')).toBeNull();
      expect(container.querySelector('a')).toBeNull();
    });
  });

  it('renders nothing when url is not http(s) (e.g., javascript:...)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { container } = render(LinkPreview, {
      props: { url: 'javascript:alert(1)' }
    });
    // Should not render skeleton/card/compact, and must not call fetch.
    expect(container.querySelector('[data-testid="link-preview-skeleton"]')).toBeNull();
    expect(container.querySelector('[data-testid="link-preview-card"]')).toBeNull();
    expect(container.querySelector('[data-testid="link-preview-compact"]')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('opens the link in a new tab with safe rel attributes', async () => {
    mockFetchOnce({
      success: true,
      metadata: {
        source: 'opengraph',
        og: { title: 'Hello', image: 'https://x.test/cover.png' }
      }
    });
    const { container } = render(LinkPreview, { props: { url: 'https://x.test/page' } });
    await waitFor(() => {
      expect(container.querySelector('a')).not.toBeNull();
    });
    const a = /** @type {HTMLAnchorElement} */ (container.querySelector('a'));
    expect(a.target).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.href).toBe('https://x.test/page');
  });

  it('drops the thumbnail but keeps the card when the OG image fails to load', async () => {
    mockFetchOnce({
      success: true,
      metadata: {
        source: 'opengraph',
        og: {
          title: 'Hello World',
          description: 'A short description',
          image: 'https://x.test/broken.png',
          siteName: 'X Test'
        }
      }
    });
    const { container } = render(LinkPreview, { props: { url: 'https://x.test/page' } });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="link-preview-thumb"]')).not.toBeNull();
    });
    const img = /** @type {HTMLImageElement} */ (container.querySelector('img'));
    expect(img).not.toBeNull();
    // Simulate the browser failing to load the image.
    img.dispatchEvent(new Event('error'));
    await waitFor(() => {
      expect(container.querySelector('[data-testid="link-preview-thumb"]')).toBeNull();
      expect(container.querySelector('[data-testid="link-preview-card"]')).not.toBeNull();
    });
    expect(container.textContent).toContain('Hello World');
  });

  it('calls /api/reader?mode=metadata with the encoded url', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          metadata: {
            source: 'opengraph',
            og: { title: 'Hi', image: 'https://x.test/i.png' }
          }
        })
    });
    vi.stubGlobal('fetch', fetchSpy);
    render(LinkPreview, { props: { url: 'https://x.test/page?id=1' } });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    const calledWith = fetchSpy.mock.calls[0][0];
    expect(calledWith).toContain('/api/reader');
    expect(calledWith).toContain('mode=metadata');
    expect(calledWith).toContain(encodeURIComponent('https://x.test/page?id=1'));
  });
});
