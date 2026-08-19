/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { strToU8 } from 'fflate';
import { isH5pArchive, wrapH5p } from '../h5p-wrap.js';
import { ensureDefaultIcon, extractXdcMeta } from '../xdc-archive.js';

afterEach(() => vi.unstubAllGlobals());

function fakeH5p() {
  return new Map([
    ['h5p.json', strToU8(JSON.stringify({ title: 'Peace Quiz', mainLibrary: 'H5P.QuestionSet' }))],
    ['content/content.json', strToU8('{}')],
    ['H5P.QuestionSet-1.20/library.json', strToU8('{}')]
  ]);
}

const FAKE_MANIFEST = ['main.bundle.js', 'frame.bundle.js', 'styles/h5p.css', 'fonts/h5p.woff2'];

function stubAssets() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      if (String(url).endsWith('manifest.json')) return Response.json(FAKE_MANIFEST);
      return new Response(`/* asset ${url} */`);
    })
  );
}

describe('h5p-wrap', () => {
  it('detects h5p archives', () => {
    expect(isH5pArchive(fakeH5p())).toBe(true);
    expect(isH5pArchive(new Map([['index.html', strToU8('')]]))).toBe(false);
  });

  it('wraps into the xdc layout with player assets and original files under h5p/', async () => {
    stubAssets();
    const { files, name } = await wrapH5p(fakeH5p(), 'fallback');
    expect(name).toBe('Peace Quiz');
    expect(files.get('index.html')).toBeTruthy();
    expect(files.get('manifest.toml')).toBeTruthy();
    expect(files.get('h5p-standalone/main.bundle.js')).toBeTruthy();
    expect(files.get('h5p-standalone/frame.bundle.js')).toBeTruthy();
    expect(files.get('h5p-standalone/styles/h5p.css')).toBeTruthy();
    expect(files.get('h5p-standalone/fonts/h5p.woff2')).toBeTruthy();
    expect(files.get('h5p/h5p.json')).toBeTruthy();
    expect(files.get('h5p/content/content.json')).toBeTruthy();
  });

  it('index.html boots the player and installs the xAPI shim', async () => {
    stubAssets();
    const { files } = await wrapH5p(fakeH5p(), 'fallback');
    const html = new TextDecoder().decode(files.get('index.html'));
    expect(html).toContain('<script src="webxdc.js"></script>');
    expect(html).toContain("h5pJsonPath: './h5p'");
    expect(html).toContain("frameJs: './h5p-standalone/frame.bundle.js'");
    expect(html).toContain("frameCss: './h5p-standalone/styles/h5p.css'");
    expect(html).toContain("externalDispatcher.on('xAPI'");
    expect(html).toContain('webxdc.sendUpdate');
  });

  it('ships no icon of its own — ensureDefaultIcon + extractXdcMeta discover the injected default', async () => {
    // wrapH5p namespaces the original package under h5p/, so even an H5P
    // package that had its own icon won't surface it at the top level —
    // the wrapped archive always needs the default injected.
    stubAssets();
    const { files } = await wrapH5p(fakeH5p(), 'fallback');
    expect(files.get('icon.png')).toBeUndefined();
    expect(files.get('icon.jpg')).toBeUndefined();

    const withIcon = ensureDefaultIcon(files, new Uint8Array([1, 2, 3, 4]));
    const meta = extractXdcMeta(withIcon);
    expect(meta.iconMime).toBe('image/png');
    expect(meta.iconBytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('falls back to the provided name when h5p.json is unreadable', async () => {
    stubAssets();
    const broken = new Map([['h5p.json', strToU8('{oops')]]);
    const { name } = await wrapH5p(broken, 'My Upload');
    expect(name).toBe('My Upload');
  });
});
