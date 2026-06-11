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

  it('renders Card variant when metadata.image is present', async () => {
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
    await waitFor(() => {
      const card = container.querySelector('[data-testid="link-preview-card"]');
      expect(card).not.toBeNull();
    });
    expect(container.querySelector('img[alt=""]')).not.toBeNull();
    expect(container.textContent).toContain('Hello World');
    expect(container.textContent).toContain('A short description');
    expect(container.textContent).toContain('X Test');
  });

  it('renders Compact variant when image is missing but title is present', async () => {
    mockFetchOnce({
      success: true,
      metadata: { source: 'opengraph', og: { title: 'Hello', siteName: 'X Test' } }
    });
    const { container } = render(LinkPreview, { props: { url: 'https://x.test/page' } });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="link-preview-compact"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-testid="link-preview-card"]')).toBeNull();
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

  it('renders Compact with hostname fallback when only siteName is present', async () => {
    mockFetchOnce({
      success: true,
      metadata: { source: 'opengraph', og: { siteName: 'X Test' } }
    });
    const { container } = render(LinkPreview, { props: { url: 'https://example.test/page' } });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="link-preview-compact"]')).not.toBeNull();
    });
    expect(container.textContent).toContain('example.test');
    expect(container.textContent).toContain('X Test');
    // Hostname must appear exactly once — no duplicate from siteName fallback.
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

  it('falls back to Compact variant when the OG image fails to load', async () => {
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
      expect(container.querySelector('[data-testid="link-preview-card"]')).not.toBeNull();
    });
    const img = /** @type {HTMLImageElement} */ (container.querySelector('img'));
    expect(img).not.toBeNull();
    // Simulate the browser failing to load the image.
    img.dispatchEvent(new Event('error'));
    await waitFor(() => {
      expect(container.querySelector('[data-testid="link-preview-card"]')).toBeNull();
      expect(container.querySelector('[data-testid="link-preview-compact"]')).not.toBeNull();
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
