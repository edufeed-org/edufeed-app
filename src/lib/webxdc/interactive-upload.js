/**
 * Normalize a user-picked interactive package (.h5p / .xdc / .html) into a
 * ready-to-upload .xdc File plus license-modal prefill. Extracted from the
 * former InteractivePackageInput so the generic upload flow
 * (LicensedFileInput) can run the same pipeline on detected candidates.
 *
 * Dynamically imported by callers — keeps the zip/wrap machinery out of the
 * default bundle until an interactive file actually shows up.
 */
import { unzipXdc, zipXdc, extractXdcMeta, wrapHtml, ensureDefaultIcon } from './xdc-archive.js';
import { isH5pArchive, wrapH5p } from './h5p-wrap.js';

export const SIZE_WARN_BYTES = 50 * 1024 * 1024;

/**
 * Classify a filename for interactive handling.
 * @param {string} fileName
 * @returns {'package' | 'html' | null} 'package' auto-triggers the pipeline,
 *   'html' needs user confirmation first, null is not a candidate.
 */
export function isInteractiveCandidate(fileName) {
  const lower = (fileName || '').toLowerCase();
  if (lower.endsWith('.h5p') || lower.endsWith('.xdc')) return 'package';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  return null;
}

/** @param {string} fileName */
function stripExt(fileName) {
  return fileName.replace(/\.(h5p|xdc|html?)$/i, '');
}

/**
 * @typedef {Object} PreparedInteractivePackage
 * @property {File} file - Normalized .xdc (type application/x-webxdc)
 * @property {Uint8Array} bytes - The .xdc bytes (for inline preview)
 * @property {string} name - Human-readable app name (manifest / h5p.json / filename)
 * @property {Uint8Array | null} iconBytes
 * @property {string | null} iconMime
 * @property {string | null} licenseUrl - h5p.json license prefill
 * @property {string | null} credit - h5p.json authors prefill
 * @property {string | null} source - h5p.json source prefill
 * @property {boolean} sizeWarning
 */

/**
 * Run the full normalize pipeline: unwrap/wrap into an .xdc file map, ensure
 * an icon (best-effort fetch of the app default), re-zip deterministically.
 * Throws when the result would not contain an index.html.
 * @param {File} file
 * @returns {Promise<PreparedInteractivePackage>}
 */
export async function prepareInteractivePackage(file) {
  const inputBytes = new Uint8Array(await file.arrayBuffer());
  let name = stripExt(file.name);
  let files;
  let licenseUrl = /** @type {string | null} */ (null);
  let credit = /** @type {string | null} */ (null);
  let source = /** @type {string | null} */ (null);

  if (isInteractiveCandidate(file.name) === 'html') {
    files = wrapHtml(inputBytes, name);
  } else {
    const unzipped = unzipXdc(inputBytes);
    if (isH5pArchive(unzipped)) {
      const wrapped = await wrapH5p(unzipped, name);
      files = wrapped.files;
      name = wrapped.name;
      licenseUrl = wrapped.licenseUrl;
      credit = wrapped.credit;
      source = wrapped.source;
    } else {
      files = unzipped;
      const meta = extractXdcMeta(files);
      if (meta.name) name = meta.name;
    }
  }

  if (!files.get('index.html')) {
    throw new Error('Invalid package: no index.html');
  }

  // Spec requires every archive to ship an icon. Fetched here so the pure
  // archive modules stay network-free, applied uniformly across all three
  // input paths (raw .xdc passthrough included).
  if (!files.get('icon.png') && !files.get('icon.jpg')) {
    try {
      const iconRes = await fetch('/icon-192x192.png');
      if (iconRes.ok) {
        files = ensureDefaultIcon(files, new Uint8Array(await iconRes.arrayBuffer()));
      }
    } catch {
      // best-effort default icon — a missing one never blocks publishing
    }
  }

  const meta = extractXdcMeta(files);
  const xdcBytes = zipXdc(files);
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'app';

  return {
    file: new File([/** @type {BlobPart} */ (xdcBytes)], `${slug}.xdc`, {
      type: 'application/x-webxdc'
    }),
    bytes: xdcBytes,
    name,
    iconBytes: meta.iconBytes,
    iconMime: meta.iconMime,
    licenseUrl,
    credit,
    source,
    sizeWarning: xdcBytes.byteLength > SIZE_WARN_BYTES
  };
}
