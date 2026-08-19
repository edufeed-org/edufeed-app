/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  unzipXdc,
  zipXdc,
  extractXdcMeta,
  buildManifest,
  wrapHtml,
  sha256Bytes,
  fetchAndVerifyXdc,
  XdcIntegrityError
} from '../xdc-archive.js';

function makeXdc(extra = {}) {
  return zipSync({
    'index.html': strToU8('<html><head></head><body>hi</body></html>'),
    'manifest.toml': strToU8('name = "Test App"'),
    'icon.png': new Uint8Array([137, 80, 78, 71]),
    ...extra
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('xdc-archive', () => {
  it('unzips with normalized paths and skips directories', () => {
    const files = unzipXdc(makeXdc({ 'sub\\dir/a.js': strToU8('1') }));
    expect(files.get('sub/dir/a.js')).toBeTruthy();
    expect([...files.keys()].every((k) => !k.startsWith('/'))).toBe(true);
  });

  it('round-trips through zipXdc', () => {
    const files = unzipXdc(makeXdc());
    const again = unzipXdc(zipXdc(files));
    expect([...again.keys()].sort()).toEqual([...files.keys()].sort());
  });

  it('zipXdc is deterministic for identical input', async () => {
    const files = new Map([['index.html', strToU8('<p>x</p>')]]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
    const a = await sha256Bytes(zipXdc(files));
    vi.setSystemTime(new Date('2030-06-15T12:34:56Z'));
    const b = await sha256Bytes(zipXdc(files));
    vi.useRealTimers();
    expect(a).toBe(b);
  });

  it('extracts manifest name and icon', () => {
    const meta = extractXdcMeta(unzipXdc(makeXdc()));
    expect(meta.name).toBe('Test App');
    expect(meta.iconMime).toBe('image/png');
    expect(meta.iconBytes?.length).toBe(4);
  });

  it('tolerates malformed manifest', () => {
    const meta = extractXdcMeta(unzipXdc(makeXdc({ 'manifest.toml': strToU8('name = = broken') })));
    expect(meta.name).toBeNull();
  });

  it('buildManifest escapes quotes', () => {
    expect(buildManifest('My "App"')).toBe('name = "My \\"App\\""\n');
  });

  it('wrapHtml produces index.html + manifest', () => {
    const files = wrapHtml(strToU8('<p>x</p>'), 'Quiz');
    expect(files.get('index.html')).toBeTruthy();
    expect(new TextDecoder().decode(files.get('manifest.toml'))).toContain('Quiz');
  });

  it('fetchAndVerifyXdc rejects hash mismatch', async () => {
    const bytes = makeXdc();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes))
    );
    await expect(fetchAndVerifyXdc('https://x/app.xdc', 'ff'.repeat(32))).rejects.toBeInstanceOf(
      XdcIntegrityError
    );
  });

  it('fetchAndVerifyXdc accepts matching hash and requires index.html', async () => {
    const bytes = makeXdc();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes))
    );
    const hash = await sha256Bytes(bytes);
    const files = await fetchAndVerifyXdc('https://x/app.xdc', hash);
    expect(files.get('index.html')).toBeTruthy();

    const noIndex = zipSync({ 'manifest.toml': strToU8('name = "x"') });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(noIndex))
    );
    const h2 = await sha256Bytes(noIndex);
    await expect(fetchAndVerifyXdc('https://x/b.xdc', h2)).rejects.toThrow(/index\.html/);
  });

  it('fetchAndVerifyXdc rejects missing hash (undefined)', async () => {
    const bytes = makeXdc();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes))
    );
    await expect(fetchAndVerifyXdc('https://x/app.xdc', undefined)).rejects.toBeInstanceOf(
      XdcIntegrityError
    );
  });

  it('fetchAndVerifyXdc rejects empty hash string', async () => {
    const bytes = makeXdc();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes))
    );
    await expect(fetchAndVerifyXdc('https://x/app.xdc', '')).rejects.toBeInstanceOf(
      XdcIntegrityError
    );
  });

  it('unzipXdc rejects colliding paths', () => {
    // Create a zip with two entries that normalize to the same path
    const collidingZip = zipSync({
      'sub/dir/a.js': strToU8('1'),
      'sub\\dir\\a.js': strToU8('2'),
      'index.html': strToU8('hi'),
      'manifest.toml': strToU8('name = "Test"')
    });
    expect(() => unzipXdc(collidingZip)).toThrow(/duplicate path/);
  });
});
