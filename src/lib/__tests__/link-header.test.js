/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  splitModulepreloadLinks,
  renderModulepreloadTags,
  preloadLinksHandle
} from '$lib/server/link-header.js';

/** @param {string} name */
const MP = (name) => `<./_app/immutable/${name}>; rel="modulepreload"; nopush`;
const CSS = '<./_app/immutable/assets/0.abc.css>; rel="preload"; as="style"; nopush';
const FONT =
  '<./_app/immutable/assets/outfit.woff2>; rel="preload"; as="font"; type="font/woff2"; crossorigin; nopush';

describe('splitModulepreloadLinks', () => {
  it('extracts modulepreload paths in header order and leaves nothing else', () => {
    const value = [MP('entry/start.js'), MP('entry/app.js'), MP('chunks/x.js')].join(', ');
    expect(splitModulepreloadLinks(value)).toEqual({
      modulePaths: [
        './_app/immutable/entry/start.js',
        './_app/immutable/entry/app.js',
        './_app/immutable/chunks/x.js'
      ],
      remaining: null
    });
  });

  it('keeps stylesheet and font preloads as the remaining header', () => {
    const value = [CSS, MP('entry/start.js'), FONT, MP('chunks/x.js')].join(', ');
    expect(splitModulepreloadLinks(value)).toEqual({
      modulePaths: ['./_app/immutable/entry/start.js', './_app/immutable/chunks/x.js'],
      remaining: `${CSS}, ${FONT}`
    });
  });

  it('passes a header without modulepreloads through untouched', () => {
    expect(splitModulepreloadLinks(CSS)).toEqual({ modulePaths: [], remaining: CSS });
  });

  it('handles empty input', () => {
    expect(splitModulepreloadLinks('')).toEqual({ modulePaths: [], remaining: null });
    expect(splitModulepreloadLinks(null)).toEqual({ modulePaths: [], remaining: null });
  });
});

describe('renderModulepreloadTags', () => {
  it('renders one modulepreload link tag per path', () => {
    expect(renderModulepreloadTags(['../_app/immutable/entry/start.js', './x.js'])).toBe(
      '<link rel="modulepreload" href="../_app/immutable/entry/start.js">' +
        '<link rel="modulepreload" href="./x.js">'
    );
  });

  it('escapes attribute-breaking characters', () => {
    expect(renderModulepreloadTags(['./a"b&c.js'])).toBe(
      '<link rel="modulepreload" href="./a&quot;b&amp;c.js">'
    );
  });

  it('renders nothing for no paths', () => {
    expect(renderModulepreloadTags([])).toBe('');
  });
});

describe('preloadLinksHandle', () => {
  const event = /** @type {any} */ ({ url: new URL('http://localhost/') });
  const html = '<html><head><title>x</title></head><body></body></html>';

  /** @param {string} link @param {Record<string, string>} [extra] */
  const page = (link, extra = {}) =>
    new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html',
        'content-length': String(html.length),
        link,
        ...extra
      }
    });

  it('moves modulepreload entries from the Link header into the head', async () => {
    const original = page([MP('entry/start.js'), MP('entry/app.js')].join(', '), {
      etag: '"abc"'
    });
    const response = await preloadLinksHandle({ event, resolve: async () => original });

    expect(response.headers.get('link')).toBeNull();
    expect(await response.text()).toBe(
      '<html><head><title>x</title>' +
        '<link rel="modulepreload" href="./_app/immutable/entry/start.js">' +
        '<link rel="modulepreload" href="./_app/immutable/entry/app.js">' +
        '</head><body></body></html>'
    );
  });

  it('keeps status, etag and content-type but drops the stale content-length', async () => {
    const original = page(MP('entry/start.js'), { etag: '"abc"' });
    const response = await preloadLinksHandle({ event, resolve: async () => original });

    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"abc"');
    expect(response.headers.get('content-type')).toBe('text/html');
    expect(response.headers.get('content-length')).toBeNull();
  });

  it('leaves non-module preload entries in the Link header', async () => {
    const original = page([CSS, MP('entry/start.js')].join(', '));
    const response = await preloadLinksHandle({ event, resolve: async () => original });
    expect(response.headers.get('link')).toBe(CSS);
  });

  it('passes responses without modulepreloads through by identity', async () => {
    const json = new Response('{}', { headers: { 'content-type': 'application/json' } });
    expect(await preloadLinksHandle({ event, resolve: async () => json })).toBe(json);

    const cssOnly = page(CSS);
    expect(await preloadLinksHandle({ event, resolve: async () => cssOnly })).toBe(cssOnly);
  });

  it('only rewrites successful HTML responses', async () => {
    const notHtml = new Response('x', {
      headers: { 'content-type': 'text/plain', link: MP('entry/start.js') }
    });
    expect(await preloadLinksHandle({ event, resolve: async () => notHtml })).toBe(notHtml);

    const notOk = new Response('x', {
      status: 500,
      headers: { 'content-type': 'text/html', link: MP('entry/start.js') }
    });
    expect(await preloadLinksHandle({ event, resolve: async () => notOk })).toBe(notOk);
  });
});
