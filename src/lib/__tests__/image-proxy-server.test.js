/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';
import sharp from 'sharp';
import { GET } from '../../routes/api/image/+server.js';

/** Build a small solid-colour PNG to act as the upstream source image. */
async function makeSourcePng(width = 800, height = 800) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 50, b: 50 } }
  })
    .png()
    .toBuffer();
}

/** Build a small 2-frame animated GIF to act as the upstream source image. */
async function makeSourceAnimatedGif(width = 64, height = 64) {
  const frame = (/** @type {{r:number,g:number,b:number}} */ background) =>
    sharp({ create: { width, height, channels: 3, background } })
      .png()
      .toBuffer();
  const frames = await Promise.all([frame({ r: 255, g: 0, b: 0 }), frame({ r: 0, g: 0, b: 255 })]);
  return sharp(frames, { join: { animated: true } })
    .gif()
    .toBuffer();
}

/**
 * Stub global.fetch to return the given image buffer as an upstream image.
 * @param {Buffer} buffer
 * @param {string} [contentType]
 */
function stubUpstream(buffer, contentType = 'image/png') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      headers: {
        get: (/** @type {string} */ name) =>
          name.toLowerCase() === 'content-type' ? contentType : null
      },
      arrayBuffer: async () =>
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    }))
  );
}

/** @param {string} query */
function callGET(query) {
  const url = new URL(`http://localhost/api/image?${query}`);
  return GET(/** @type {any} */ ({ url }));
}

describe('image proxy /api/image', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to webp output preserving aspect ratio', async () => {
    stubUpstream(await makeSourcePng(800, 800));

    const res = await callGET('url=https%3A%2F%2Fexample.com%2Fa.png&w=1200&h=630');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');

    const out = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
    // fit:inside on a square source bounded by 1200x630 → height capped at 630, square
    expect(meta.height).toBe(630);
    expect(meta.width).toBe(630);
  });

  it('preserves animation when proxying an animated GIF to webp', async () => {
    stubUpstream(await makeSourceAnimatedGif(), 'image/gif');

    const res = await callGET('url=https%3A%2F%2Fexample.com%2Fa.gif&w=960&h=960');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');

    const out = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(out, { animated: true }).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.pages).toBe(2);
  });

  it('flattens animated GIF to a single frame for jpeg output', async () => {
    stubUpstream(await makeSourceAnimatedGif(), 'image/gif');

    const res = await callGET('url=https%3A%2F%2Fexample.com%2Fa.gif&w=64&h=64&fmt=jpeg');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');

    const out = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.height).toBe(64);
  });

  it('produces an exact cover-cropped jpeg when fit=cover&fmt=jpeg', async () => {
    stubUpstream(await makeSourcePng(800, 800));

    const res = await callGET(
      'url=https%3A%2F%2Fexample.com%2Fa.png&w=1200&h=630&fit=cover&fmt=jpeg'
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');

    const out = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(630);
  });
});
