/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { strToU8 } from 'fflate';
import { isH5pArchive, wrapH5p, h5pLicenseToUrl } from '../h5p-wrap.js';
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
    // Div embed keeps every subresource request on the SW-controlled app
    // document — the default iframe embed's about:blank inner iframe bypasses
    // iframe.diy's service worker in Chrome, so all H5P library scripts fall
    // through to the host's HTML bootstrap page instead of the sandboxed app.
    expect(html).toContain("embedType: 'div'");
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

  it('returns null licenseUrl/credit when h5p.json has no license/authors', async () => {
    stubAssets();
    const { licenseUrl, credit } = await wrapH5p(fakeH5p(), 'fallback');
    expect(licenseUrl).toBeNull();
    expect(credit).toBeNull();
  });

  it('prefills licenseUrl/credit from h5p.json license + licenseVersion + authors', async () => {
    stubAssets();
    const files = new Map([
      [
        'h5p.json',
        strToU8(
          JSON.stringify({
            title: 'Peace Quiz',
            license: 'CC BY-SA',
            licenseVersion: '4.0',
            authors: [{ name: 'Jane Doe', role: 'Author' }]
          })
        )
      ]
    ]);
    const { licenseUrl, credit } = await wrapH5p(files, 'fallback');
    expect(licenseUrl).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(credit).toBe('Jane Doe');
  });

  it('maps an unmappable H5P license code ("U") to a null licenseUrl', async () => {
    stubAssets();
    const files = new Map([
      ['h5p.json', strToU8(JSON.stringify({ title: 'Peace Quiz', license: 'U' }))]
    ]);
    const { licenseUrl } = await wrapH5p(files, 'fallback');
    expect(licenseUrl).toBeNull();
  });

  it('joins multiple authors\' names with ", "', async () => {
    stubAssets();
    const files = new Map([
      [
        'h5p.json',
        strToU8(
          JSON.stringify({
            title: 'Peace Quiz',
            authors: [{ name: 'Jane Doe' }, { name: 'John Smith', role: 'Editor' }]
          })
        )
      ]
    ]);
    const { credit } = await wrapH5p(files, 'fallback');
    expect(credit).toBe('Jane Doe, John Smith');
  });
});

describe('h5pLicenseToUrl', () => {
  it('maps the six CC BY* codes to versioned CC license URLs', () => {
    expect(h5pLicenseToUrl('CC BY', '4.0')).toBe('https://creativecommons.org/licenses/by/4.0/');
    expect(h5pLicenseToUrl('CC BY-SA', '4.0')).toBe(
      'https://creativecommons.org/licenses/by-sa/4.0/'
    );
    expect(h5pLicenseToUrl('CC BY-ND', '4.0')).toBe(
      'https://creativecommons.org/licenses/by-nd/4.0/'
    );
    expect(h5pLicenseToUrl('CC BY-NC', '4.0')).toBe(
      'https://creativecommons.org/licenses/by-nc/4.0/'
    );
    expect(h5pLicenseToUrl('CC BY-NC-SA', '4.0')).toBe(
      'https://creativecommons.org/licenses/by-nc-sa/4.0/'
    );
    expect(h5pLicenseToUrl('CC BY-NC-ND', '4.0')).toBe(
      'https://creativecommons.org/licenses/by-nc-nd/4.0/'
    );
  });

  it('defaults to version 4.0 when licenseVersion is missing', () => {
    expect(h5pLicenseToUrl('CC BY-SA')).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
  });

  it('is case-tolerant on the code', () => {
    expect(h5pLicenseToUrl('cc by-sa', '4.0')).toBe(
      'https://creativecommons.org/licenses/by-sa/4.0/'
    );
  });

  it('maps CC0 1.0 and PD/CC PDM to public-domain URLs', () => {
    expect(h5pLicenseToUrl('CC0 1.0')).toBe('https://creativecommons.org/publicdomain/zero/1.0/');
    expect(h5pLicenseToUrl('PD')).toBe('https://creativecommons.org/publicdomain/mark/1.0/');
    expect(h5pLicenseToUrl('CC PDM')).toBe('https://creativecommons.org/publicdomain/mark/1.0/');
  });

  it('returns null for unmappable codes (U, C, GNU GPL, ODC PDDL, unknown)', () => {
    expect(h5pLicenseToUrl('U')).toBeNull();
    expect(h5pLicenseToUrl('C')).toBeNull();
    expect(h5pLicenseToUrl('GNU GPL')).toBeNull();
    expect(h5pLicenseToUrl('ODC PDDL')).toBeNull();
    expect(h5pLicenseToUrl('Something Else')).toBeNull();
    expect(h5pLicenseToUrl(undefined)).toBeNull();
    expect(h5pLicenseToUrl(null)).toBeNull();
  });
});
