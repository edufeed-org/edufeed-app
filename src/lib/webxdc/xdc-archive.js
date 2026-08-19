/**
 * .xdc (webxdc ZIP) archive handling: unzip/zip, manifest + icon metadata,
 * HTML wrapping, and download-with-integrity-check. Pure module — no Svelte,
 * no Nostr. Safe in node and browser (uses globalThis.crypto).
 */
import { unzipSync, zipSync } from 'fflate';
import { parse as parseTOML } from 'smol-toml';

export class XdcIntegrityError extends Error {}

/** @param {Uint8Array} bytes @returns {Map<string, Uint8Array>} */
export function unzipXdc(bytes) {
  const unzipped = unzipSync(bytes);
  const files = new Map();
  for (const [path, content] of Object.entries(unzipped)) {
    const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized.endsWith('/')) continue;
    if (files.has(normalized)) {
      throw new Error(`Invalid package: duplicate path after normalization: ${normalized}`);
    }
    files.set(normalized, content);
  }
  return files;
}

/** @param {Map<string, Uint8Array>} files @returns {Uint8Array} */
export function zipXdc(files) {
  return zipSync(Object.fromEntries(files));
}

/** @param {Map<string, Uint8Array>} files */
export function extractXdcMeta(files) {
  let name = null;
  const manifestBytes = files.get('manifest.toml');
  if (manifestBytes) {
    try {
      const manifest = parseTOML(new TextDecoder().decode(manifestBytes));
      if (typeof manifest.name === 'string') name = manifest.name;
    } catch {
      // malformed manifest — name stays null
    }
  }
  const png = files.get('icon.png');
  const jpg = files.get('icon.jpg');
  const iconBytes = png ?? jpg ?? null;
  const iconMime = png ? 'image/png' : jpg ? 'image/jpeg' : null;
  return { name, iconBytes, iconMime };
}

/** @param {string} name @returns {string} */
export function buildManifest(name) {
  const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `name = "${escaped}"\n`;
}

/**
 * Wrap a self-contained HTML file into an .xdc file map.
 * @param {Uint8Array} htmlBytes
 * @param {string} name
 * @returns {Map<string, Uint8Array>}
 */
export function wrapHtml(htmlBytes, name) {
  return new Map([
    ['index.html', htmlBytes],
    ['manifest.toml', new TextEncoder().encode(buildManifest(name))]
  ]);
}

/** @param {Uint8Array} bytes @returns {Promise<string>} hex */
export async function sha256Bytes(bytes) {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    /** @type {BufferSource} */ (bytes)
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Download an archive, verify its SHA-256 against the published `x` tag
 * (spec requirement — never execute unverified bytes), unzip, require index.html.
 * @param {string} url
 * @param {string | undefined} expectedSha256 - required; undefined/empty is rejected below
 * @returns {Promise<Map<string, Uint8Array>>}
 */
export async function fetchAndVerifyXdc(url, expectedSha256) {
  if (!expectedSha256) {
    throw new XdcIntegrityError('No expected hash provided — refusing to run unverified package');
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch package: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const actual = await sha256Bytes(bytes);
  if (actual !== expectedSha256.toLowerCase()) {
    throw new XdcIntegrityError(`Package hash mismatch: expected ${expectedSha256}, got ${actual}`);
  }
  const files = unzipXdc(bytes);
  if (!files.get('index.html')) throw new Error('Invalid package: missing index.html');
  return files;
}
