/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { isInteractiveCandidate, prepareInteractivePackage } from '../interactive-upload.js';
import { unzipXdc } from '../xdc-archive.js';

afterEach(() => vi.unstubAllGlobals());

const FAKE_MANIFEST = ['main.bundle.js', 'frame.bundle.js'];
const DEFAULT_ICON = new Uint8Array([9, 9, 9]);

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const u = String(url);
      if (u.endsWith('manifest.json')) return Response.json(FAKE_MANIFEST);
      if (u.endsWith('icon-192x192.png'))
        return new Response(DEFAULT_ICON, { headers: { 'content-type': 'image/png' } });
      return new Response(`/* asset ${u} */`);
    })
  );
}

/** @param {Record<string, Uint8Array>} entries */
function zipFile(name, entries) {
  const bytes = zipSync(entries);
  return new File([bytes], name);
}

function fakeXdcFile(name = 'my-app.xdc') {
  return zipFile(name, {
    'index.html': strToU8('<html></html>'),
    'manifest.toml': strToU8('name = "Cool App"')
  });
}

function fakeH5pFile(name = 'quiz.h5p') {
  return zipFile(name, {
    'h5p.json': strToU8(
      JSON.stringify({
        title: 'Peace Quiz',
        license: 'CC BY-SA',
        licenseVersion: '4.0',
        authors: [{ name: 'Jane Doe' }],
        source: 'https://example.org/original'
      })
    ),
    'content/content.json': strToU8('{}')
  });
}

describe('isInteractiveCandidate', () => {
  it('classifies .h5p and .xdc as package', () => {
    expect(isInteractiveCandidate('quiz.h5p')).toBe('package');
    expect(isInteractiveCandidate('app.XDC')).toBe('package');
  });

  it('classifies .html/.htm as html', () => {
    expect(isInteractiveCandidate('game.html')).toBe('html');
    expect(isInteractiveCandidate('game.HTM')).toBe('html');
  });

  it('returns null for anything else', () => {
    expect(isInteractiveCandidate('doc.pdf')).toBeNull();
    expect(isInteractiveCandidate('photo.png')).toBeNull();
    expect(isInteractiveCandidate('archive.zip')).toBeNull();
    expect(isInteractiveCandidate('')).toBeNull();
  });
});

describe('prepareInteractivePackage', () => {
  it('passes a raw .xdc through, reading the manifest name', async () => {
    stubFetch();
    const prepared = await prepareInteractivePackage(fakeXdcFile());
    expect(prepared.name).toBe('Cool App');
    expect(prepared.file.name).toBe('cool-app.xdc');
    expect(prepared.file.type).toBe('application/x-webxdc');
    const files = unzipXdc(new Uint8Array(await prepared.file.arrayBuffer()));
    expect(files.get('index.html')).toBeTruthy();
  });

  it('wraps an .h5p and surfaces license/credit/source prefill', async () => {
    stubFetch();
    const prepared = await prepareInteractivePackage(fakeH5pFile());
    expect(prepared.name).toBe('Peace Quiz');
    expect(prepared.licenseUrl).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(prepared.credit).toBe('Jane Doe');
    expect(prepared.source).toBe('https://example.org/original');
    const files = unzipXdc(new Uint8Array(await prepared.file.arrayBuffer()));
    expect(files.get('index.html')).toBeTruthy();
    expect(files.get('h5p/h5p.json')).toBeTruthy();
  });

  it('wraps a bare .html file into an app named after the file', async () => {
    stubFetch();
    const html = new File([strToU8('<html><body>hi</body></html>')], 'my-game.html');
    const prepared = await prepareInteractivePackage(html);
    expect(prepared.name).toBe('my-game');
    const files = unzipXdc(new Uint8Array(await prepared.file.arrayBuffer()));
    expect(files.get('index.html')).toBeTruthy();
  });

  it('injects the default icon when the archive ships none', async () => {
    stubFetch();
    const prepared = await prepareInteractivePackage(fakeXdcFile());
    expect(prepared.iconBytes).toEqual(DEFAULT_ICON);
    expect(prepared.iconMime).toBe('image/png');
    const files = unzipXdc(new Uint8Array(await prepared.file.arrayBuffer()));
    expect(files.get('icon.png')).toEqual(DEFAULT_ICON);
  });

  it('keeps an archive-provided icon instead of the default', async () => {
    stubFetch();
    const ownIcon = new Uint8Array([1, 2, 3]);
    const file = zipFile('app.xdc', {
      'index.html': strToU8('<html></html>'),
      'icon.png': ownIcon
    });
    const prepared = await prepareInteractivePackage(file);
    expect(prepared.iconBytes).toEqual(ownIcon);
  });

  it('survives a failing default-icon fetch (icon is best-effort)', async () => {
    stubFetch();
    const fetchMock = /** @type {import('vitest').Mock} */ (globalThis.fetch);
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith('icon-192x192.png')) throw new Error('offline');
      if (String(url).endsWith('manifest.json')) return Response.json(FAKE_MANIFEST);
      return new Response('/* asset */');
    });
    const prepared = await prepareInteractivePackage(fakeXdcFile());
    expect(prepared.iconBytes).toBeNull();
  });

  it('rejects an archive without index.html', async () => {
    stubFetch();
    const file = zipFile('broken.xdc', { 'readme.txt': strToU8('nope') });
    await expect(prepareInteractivePackage(file)).rejects.toThrow(/index\.html/);
  });

  it('flags packages above the size-warning threshold', async () => {
    stubFetch();
    const small = await prepareInteractivePackage(fakeXdcFile());
    expect(small.sizeWarning).toBe(false);
  });

  it('falls back to the stripped filename when no name metadata exists', async () => {
    stubFetch();
    const file = zipFile('untitled-thing.xdc', { 'index.html': strToU8('<html></html>') });
    const prepared = await prepareInteractivePackage(file);
    expect(prepared.name).toBe('untitled-thing');
  });
});
