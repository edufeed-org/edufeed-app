/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const env = vi.hoisted(() => /** @type {Record<string, string | undefined>} */ ({}));
vi.mock('$env/dynamic/private', () => ({ env }));
const buildSitemapXml = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/geo/sitemap.js', async (importOriginal) => ({
  .../** @type {any} */ (await importOriginal()),
  buildSitemapXml
}));

import { GET as robots } from '../../../routes/robots.txt/+server.js';
import { GET as sitemap } from '../../../routes/sitemap.xml/+server.js';

describe('/robots.txt', () => {
  beforeEach(() => {
    delete env.SEARCH_INDEXING;
  });

  it('allows crawling and names the sitemap of the serving origin', async () => {
    const res = await robots(
      /** @type {any} */ ({ url: new URL('https://stil.example/robots.txt') })
    );
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('User-agent: *\nAllow: /');
    expect(body).toContain('Sitemap: https://stil.example/sitemap.xml');
  });
});

describe('/sitemap.xml', () => {
  it('answers 503 with Retry-After while the first build fails', async () => {
    buildSitemapXml.mockRejectedValueOnce(new Error('relays down'));
    const res = await sitemap(
      /** @type {any} */ ({ url: new URL('https://a.example/sitemap.xml') })
    );
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('600');
  });

  it('serves the built sitemap as XML', async () => {
    buildSitemapXml.mockResolvedValueOnce('<urlset/>');
    const res = await sitemap(
      /** @type {any} */ ({ url: new URL('https://b.example/sitemap.xml') })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    expect(await res.text()).toBe('<urlset/>');
    expect(buildSitemapXml).toHaveBeenLastCalledWith('https://b.example', {});
  });
});

describe('SEARCH_INDEXING=false (staging, e.g. dev.edufeed.org)', () => {
  beforeEach(() => {
    env.SEARCH_INDEXING = 'false';
  });

  it('disallows all crawling and names no sitemap', async () => {
    const res = await robots(
      /** @type {any} */ ({ url: new URL('https://dev.example/robots.txt') })
    );
    const body = await res.text();
    expect(body).toBe('User-agent: *\nDisallow: /\n');
  });

  it('serves no sitemap', async () => {
    buildSitemapXml.mockClear();
    const res = await sitemap(
      /** @type {any} */ ({ url: new URL('https://dev.example/sitemap.xml') })
    );
    expect(res.status).toBe(404);
    expect(buildSitemapXml).not.toHaveBeenCalled();
  });
});
