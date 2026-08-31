/**
 * Client-side .h5p → .xdc wrapper: bundles the vendored h5p-standalone player
 * (fetched from /h5p-standalone/ static assets) around the extracted package
 * and generates an index.html that boots the player and forwards xAPI
 * statements to webxdc.sendUpdate (the Phase 2/3 results feed).
 */
import { buildManifest } from './xdc-archive.js';

/** @param {Map<string, Uint8Array>} files */
export function isH5pArchive(files) {
  return files.has('h5p.json');
}

/** CC BY* H5P license codes → creativecommons.org URL path segment. */
/** @type {Record<string, string>} */
const CC_LICENSE_SLUGS = {
  'cc by': 'by',
  'cc by-sa': 'by-sa',
  'cc by-nd': 'by-nd',
  'cc by-nc': 'by-nc',
  'cc by-nc-sa': 'by-nc-sa',
  'cc by-nc-nd': 'by-nc-nd'
};

/**
 * Map an H5P license code (+ optional version) to a license URL, or null
 * when not mappable.
 *
 * The four CC BY/CC0/PD variants that carry a version-4.0-or-implicit URL in
 * `licenseOptions.js`'s STATIC_LICENSE_OPTIONS (by, by-sa, by-nc, by-nc-sa,
 * CC0) preselect the LicenseModal's dropdown directly; by-nd, by-nc-nd, and
 * the CC-PDM/PD mark are outside that static list but still work because
 * `getLicenseOptions()` synthesizes an `<option>` for any URL it's handed.
 *
 * @param {string | undefined | null} code
 * @param {string} [version]
 * @returns {string | null}
 */
export function h5pLicenseToUrl(code, version) {
  if (typeof code !== 'string') return null;
  const normalized = code.trim().toLowerCase();
  const slug = CC_LICENSE_SLUGS[normalized];
  if (slug) return `https://creativecommons.org/licenses/${slug}/${version || '4.0'}/`;
  if (normalized === 'cc0 1.0') return 'https://creativecommons.org/publicdomain/zero/1.0/';
  if (normalized === 'cc pdm' || normalized === 'pd') {
    return 'https://creativecommons.org/publicdomain/mark/1.0/';
  }
  return null;
}

/**
 * @param {Array<{ name?: string }>} [authors]
 * @returns {string | null}
 */
function creditFromAuthors(authors) {
  if (!Array.isArray(authors) || authors.length === 0) return null;
  const names = authors
    .map((a) => (typeof a?.name === 'string' ? a.name.trim() : ''))
    .filter(Boolean);
  return names.length ? names.join(', ') : null;
}

/**
 * @param {Map<string, Uint8Array>} files - unzipped .h5p contents
 * @param {string} fallbackName
 * @returns {Promise<{ files: Map<string, Uint8Array>, name: string, licenseUrl: string | null, credit: string | null, source: string | null }>}
 */
export async function wrapH5p(files, fallbackName) {
  let name = fallbackName;
  let licenseUrl = /** @type {string | null} */ (null);
  let credit = /** @type {string | null} */ (null);
  let source = /** @type {string | null} */ (null);
  try {
    const meta = JSON.parse(new TextDecoder().decode(files.get('h5p.json')));
    if (typeof meta.title === 'string' && meta.title.trim()) name = meta.title.trim();
    licenseUrl = h5pLicenseToUrl(meta.license, meta.licenseVersion);
    credit = creditFromAuthors(meta.authors);
    source = typeof meta.source === 'string' && meta.source.trim() ? meta.source.trim() : null;
  } catch {
    // unreadable h5p.json — keep the fallback name, no license/credit/source prefill
  }

  const out = new Map();
  out.set('index.html', new TextEncoder().encode(buildIndexHtml(name)));
  out.set('manifest.toml', new TextEncoder().encode(buildManifest(name)));

  const manifestRes = await fetch('/h5p-standalone/manifest.json');
  if (!manifestRes.ok) throw new Error('Missing player asset: manifest.json');
  /** @type {string[]} */
  const assets = await manifestRes.json();

  for (const asset of assets) {
    const res = await fetch(`/h5p-standalone/${asset}`);
    if (!res.ok) throw new Error(`Missing player asset: ${asset}`);
    out.set(`h5p-standalone/${asset}`, new Uint8Array(await res.arrayBuffer()));
  }

  for (const [path, content] of files) {
    out.set(`h5p/${path}`, content);
  }
  return { files: out, name, licenseUrl, credit, source };
}

/** @param {string} title */
function buildIndexHtml(title) {
  const safeTitle = title.replace(/</g, '&lt;');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle}</title>
<link rel="stylesheet" href="./h5p-standalone/styles/h5p.css" />
<script src="webxdc.js"></script>
<script src="./h5p-standalone/main.bundle.js"></script>
<style>html, body { margin: 0; } #h5p-container { max-width: 960px; margin: 0 auto; }</style>
</head>
<body>
<div id="h5p-container"></div>
<script>
new H5PStandalone.H5P(document.getElementById('h5p-container'), {
  h5pJsonPath: './h5p',
  // about:blank iframes bypass the sandbox service worker — div embed keeps
  // all requests SW-controlled (the default iframe embed's inner about:blank
  // frame makes every H5P library request fall through to the host's HTML
  // bootstrap page in Chrome, never hitting iframe.diy's SW).
  embedType: 'div',
  frameJs: './h5p-standalone/frame.bundle.js',
  frameCss: './h5p-standalone/styles/h5p.css'
}).then(function () {
  // xAPI → webxdc: every statement becomes a durable state update. Local-only
  // in Phase 1; the same stream feeds shared community sessions in Phase 2/3.
  if (window.H5P && H5P.externalDispatcher && window.webxdc) {
    H5P.externalDispatcher.on('xAPI', function (event) {
      try {
        window.webxdc.sendUpdate(
          { payload: { type: 'xapi', statement: event.data.statement } },
          ''
        );
      } catch (e) { /* never break the activity over telemetry */ }
    });
  }
});
</script>
</body>
</html>`;
}
