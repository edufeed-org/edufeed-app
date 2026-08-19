/**
 * Client-side .h5p → .xdc wrapper: bundles the vendored h5p-standalone player
 * (fetched from /h5p-standalone/ static assets) around the extracted package
 * and generates an index.html that boots the player and forwards xAPI
 * statements to webxdc.sendUpdate (the Phase 2/3 results feed).
 */
import { buildManifest } from './xdc-archive.js';

const ASSETS = ['main.bundle.js', 'frame.bundle.js', 'styles/h5p.css'];

/** @param {Map<string, Uint8Array>} files */
export function isH5pArchive(files) {
  return files.has('h5p.json');
}

/**
 * @param {Map<string, Uint8Array>} files - unzipped .h5p contents
 * @param {string} fallbackName
 * @returns {Promise<{ files: Map<string, Uint8Array>, name: string }>}
 */
export async function wrapH5p(files, fallbackName) {
  let name = fallbackName;
  try {
    const meta = JSON.parse(new TextDecoder().decode(files.get('h5p.json')));
    if (typeof meta.title === 'string' && meta.title.trim()) name = meta.title.trim();
  } catch {
    // unreadable h5p.json — keep the fallback name
  }

  const out = new Map();
  out.set('index.html', new TextEncoder().encode(buildIndexHtml(name)));
  out.set('manifest.toml', new TextEncoder().encode(buildManifest(name)));

  for (const asset of ASSETS) {
    const res = await fetch(`/h5p-standalone/${asset}`);
    if (!res.ok) throw new Error(`Missing player asset: ${asset}`);
    out.set(`h5p-standalone/${asset}`, new Uint8Array(await res.arrayBuffer()));
  }

  for (const [path, content] of files) {
    out.set(`h5p/${path}`, content);
  }
  return { files: out, name };
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
