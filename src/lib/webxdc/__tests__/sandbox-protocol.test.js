/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  WEBXDC_CSP,
  bytesToBase64,
  utf8ToBase64,
  getMimeType,
  injectScriptTag,
  buildFetchResponse
} from '../sandbox-protocol.js';

/** @param {string} s */
const enc = (s) => new TextEncoder().encode(s);
/** @param {string} b64 */
const dec = (b64) => atob(b64);
const files = new Map([
  ['index.html', enc('<html><head><title>t</title></head><body></body></html>')],
  ['app.js', enc('console.log(1)')],
  ['webxdc.js', enc('/* bundled simulator */')]
]);
const opts = { bridgeScript: 'window.webxdc = {};' };

describe('buildFetchResponse', () => {
  it('serves / as index.html with injected bridge tag and CSP', () => {
    const res = buildFetchResponse('/', files, opts);
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/html');
    expect(res.headers['Content-Security-Policy']).toBe(WEBXDC_CSP);
    expect(dec(res.body)).toContain('<script src="/webxdc.js"></script>');
  });

  it('shadows a bundled webxdc.js with the host bridge', () => {
    const res = buildFetchResponse('/webxdc.js', files, opts);
    expect(dec(res.body)).toBe('window.webxdc = {};');
    expect(res.headers['Content-Type']).toBe('application/javascript');
  });

  it('serves regular files with mime and CSP', () => {
    const res = buildFetchResponse('/app.js', files, opts);
    expect(res.headers['Content-Type']).toBe('application/javascript');
    expect(res.headers['Content-Security-Policy']).toBe(WEBXDC_CSP);
  });

  it('404s unknown paths', () => {
    expect(buildFetchResponse('/nope.png', files, opts).status).toBe(404);
  });

  it('URL-decodes the pathname to match packaged asset names with spaces/umlauts', () => {
    const filesWithSpecialName = new Map([...files, ['ü ber.png', enc('pixels')]]);
    const res = buildFetchResponse('/%C3%BC%20ber.png', filesWithSpecialName, opts);
    expect(res.status).toBe(200);
    expect(dec(res.body)).toBe('pixels');
  });

  it('404s a malformed percent-escape instead of throwing', () => {
    expect(() => buildFetchResponse('/%E0%A4%A', files, opts)).not.toThrow();
    expect(buildFetchResponse('/%E0%A4%A', files, opts).status).toBe(404);
  });
});

describe('helpers', () => {
  it('base64 round-trips binary', () => {
    expect(bytesToBase64(new Uint8Array([0, 255, 128]))).toBe(
      btoa(String.fromCharCode(0, 255, 128))
    );
    expect(utf8ToBase64('ä')).toBe(btoa(String.fromCharCode(...new TextEncoder().encode('ä'))));
  });

  it('getMimeType maps common extensions', () => {
    expect(getMimeType('a/b.css')).toBe('text/css');
    expect(getMimeType('x.wasm')).toBe('application/wasm');
    expect(getMimeType('noext')).toBe('application/octet-stream');
  });

  it('injectScriptTag prepends when no head', () => {
    expect(injectScriptTag('<p>x</p>', '/webxdc.js')).toContain('<script src="/webxdc.js">');
  });
});
