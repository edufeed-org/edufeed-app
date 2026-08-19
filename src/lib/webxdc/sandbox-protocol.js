/**
 * iframe.diy fetch-proxy responder (protocol: JSON-RPC 2.0 over postMessage,
 * base64 bodies — see the public-domain iframe.diy protocol docs). Pure module:
 * SandboxFrame.svelte owns the postMessage wiring; this builds the responses.
 */

export const WEBXDC_CSP =
  "default-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' data: blob:; " +
  "base-uri 'self'; form-action 'self'";

const MIME = {
  html: 'text/html',
  htm: 'text/html',
  js: 'application/javascript',
  mjs: 'application/javascript',
  css: 'text/css',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
  wasm: 'application/wasm',
  txt: 'text/plain',
  xml: 'application/xml',
  vtt: 'text/vtt',
  csv: 'text/csv'
};

/** @param {string} path */
export function getMimeType(path) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

/** @param {Uint8Array} bytes */
export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** @param {string} text */
export function utf8ToBase64(text) {
  return bytesToBase64(new TextEncoder().encode(text));
}

/** Insert a script tag right after <head>, or prepend when there is none. */
export function injectScriptTag(html, src) {
  const tag = `<script src="${src}"></script>`;
  const match = html.match(/<head[^>]*>/i);
  if (match) {
    const at = match.index + match[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  return tag + html;
}

/**
 * @param {string} pathname
 * @param {Map<string, Uint8Array>} files
 * @param {{ bridgeScript: string }} opts
 */
export function buildFetchResponse(pathname, files, opts) {
  const path = pathname.replace(/^\/+/, '') || 'index.html';
  const headers = { 'Content-Security-Policy': WEBXDC_CSP, 'Cache-Control': 'no-cache' };

  // The host's webxdc bridge always shadows a bundled simulator copy.
  if (path === 'webxdc.js') {
    return {
      status: 200,
      statusText: 'OK',
      headers: { ...headers, 'Content-Type': 'application/javascript' },
      body: utf8ToBase64(opts.bridgeScript)
    };
  }

  const content = files.get(path);
  if (!content) {
    return {
      status: 404,
      statusText: 'Not Found',
      headers: { ...headers, 'Content-Type': 'text/plain' },
      body: utf8ToBase64('Not Found')
    };
  }

  const mime = getMimeType(path);
  if (mime === 'text/html') {
    const html = injectScriptTag(new TextDecoder().decode(content), '/webxdc.js');
    return {
      status: 200,
      statusText: 'OK',
      headers: { ...headers, 'Content-Type': mime },
      body: utf8ToBase64(html)
    };
  }
  return {
    status: 200,
    statusText: 'OK',
    headers: { ...headers, 'Content-Type': mime, 'Content-Length': String(content.byteLength) },
    body: bytesToBase64(content)
  };
}
