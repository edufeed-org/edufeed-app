# Interactive Resources (webxdc / H5P) — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Educators publish interactive packages (`.h5p` auto-wrapped, `.xdc`, self-contained `.html`) as AMB resources; edufeed renders them in a network-isolated iframe.diy sandbox; every app is also NIP-DC-discoverable via a dual-purpose kind-1063 event.

**Architecture:** New self-contained module `src/lib/webxdc/` (archive handling, iframe.diy protocol client, `window.webxdc` host with an `AppSync` seam backed by localStorage in Phase 1). Publishing rides the existing wizard: a new `interactive` form variant whose step-2 field wraps uploads into `.xdc`, reuses the existing Blossom + LicenseModal flow, and lands the package in `formData.encodings`/`formData.identifier`. Views key off the `application/x-webxdc` MIME.

**Tech Stack:** SvelteKit + Svelte 5 runes, JS + JSDoc, Vitest, `fflate`, `smol-toml`, `@noble/hashes`, `h5p-standalone` (vendored dist), iframe.diy protocol (JSON-RPC 2.0 over postMessage).

**Spec:** `docs/superpowers/specs/2026-08-19-webxdc-interactive-resources-design.md` (Phase 1 = spec Sections 1–4; Sections 5–6 are future plans).

## Global Constraints

- Svelte 5 runes; plain `let` for subscriptions/refs; `$state.raw()` for arrays/Sets/Maps that carry Symbols or built-ins (CLAUDE.md).
- JS with JSDoc types — no TypeScript files.
- TDD: every task writes the failing test first. Unit tests default env is jsdom; annotate `/** @vitest-environment node */` where DOM-free.
- CSP served to every sandbox response, verbatim: `default-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' data: blob:; base-uri 'self'; form-action 'self'`.
- iframe `sandbox` attribute, verbatim: `allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads` — never `allow-top-navigation`.
- Bridge caps: `sendUpdateMaxSize` 65536 bytes (JSON), realtime frames ≤ 128000 bytes.
- MIME marker everywhere: `application/x-webxdc`. Discovery filter interop target: `{kinds:[1063], "#m":["application/x-webxdc"]}`.
- No Armada (AGPL) code may be copied — implement from the public-domain iframe.diy protocol doc and the webxdc API types only.
- Commit after every green test cycle. Messages: `feat(webxdc): …` / `test(webxdc): …`.
- All new user-facing strings go through Paraglide (`messages/en.json` + `messages/de.json`, keys snake_case).

---

### Task 1: SANDBOX_DOMAIN config plumbing

**Files:**
- Modify: `src/routes/api/config/+server.js` (config object, ~line 436 area)
- Modify: `src/lib/stores/config.svelte.js` (defaultConfig ~line 219, initializeConfig merge ~line 392, runtimeConfig getter ~line 510)
- Modify: `.env.example`
- Test: `src/lib/__tests__/api-config-webxdc.test.js`

**Interfaces:**
- Produces: `runtimeConfig.webxdc.sandboxDomain: string` (default `'iframe.diy'`), consumed by Task 7/8.

- [ ] **Step 1: Write the failing test** (pattern: `src/lib/__tests__/api-config-metaclean.test.js`)

```js
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('/api/config webxdc block', () => {
  beforeEach(() => vi.resetModules());

  it('defaults sandboxDomain to iframe.diy', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: {} }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.webxdc).toEqual({ sandboxDomain: 'iframe.diy' });
  });

  it('uses SANDBOX_DOMAIN when set', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: { SANDBOX_DOMAIN: 'sandbox.edufeed.org' } }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.webxdc.sandboxDomain).toBe('sandbox.edufeed.org');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/api-config-webxdc.test.js`
Expected: FAIL — `body.webxdc` is `undefined`.

- [ ] **Step 3: Implement**

In `src/routes/api/config/+server.js`, inside the `config = { … }` literal (next to the `metadataCleaner` block):

```js
    // Webxdc sandbox host (interactive resources player)
    webxdc: {
      sandboxDomain: env.SANDBOX_DOMAIN || 'iframe.diy'
    },
```

In `src/lib/stores/config.svelte.js`: add to `defaultConfig`:

```js
  webxdc: {
    sandboxDomain: 'iframe.diy'
  },
```

in `initializeConfig` (next to the metadataCleaner merge):

```js
    webxdc: { ...defaultConfig.webxdc, ...runtimeConfig.webxdc },
```

in the exported `runtimeConfig` object:

```js
  get webxdc() {
    return config.webxdc;
  },
```

In `.env.example` (near BLOSSOM settings):

```
# Sandbox domain for interactive (webxdc) resources. Apps run on
# https://<hmac-id>.<domain>/ — default is the public iframe.diy service.
# SANDBOX_DOMAIN=iframe.diy
```

- [ ] **Step 4: Run test to verify it passes** — same command, expect PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/config/+server.js src/lib/stores/config.svelte.js .env.example src/lib/__tests__/api-config-webxdc.test.js
git commit -m "feat(webxdc): SANDBOX_DOMAIN runtime config"
```

---

### Task 2: `xdc-archive.js` — ZIP handling, manifest, integrity

**Files:**
- Create: `src/lib/webxdc/xdc-archive.js`
- Test: `src/lib/webxdc/__tests__/xdc-archive.test.js`
- Modify: `package.json` (add deps)

**Interfaces:**
- Produces (all consumed by Tasks 8/9/11):
  - `unzipXdc(bytes: Uint8Array): Map<string, Uint8Array>` — normalized paths (no leading `/`, `\`→`/`), directories skipped.
  - `zipXdc(files: Map<string, Uint8Array>): Uint8Array`
  - `extractXdcMeta(files: Map): { name: string|null, iconBytes: Uint8Array|null, iconMime: string|null }` — from `manifest.toml` + `icon.png`/`icon.jpg`.
  - `buildManifest(name: string): string` — TOML with escaped quotes/backslashes.
  - `wrapHtml(htmlBytes: Uint8Array, name: string): Map<string, Uint8Array>` — `index.html` + `manifest.toml`.
  - `sha256Bytes(bytes: Uint8Array): Promise<string>` — hex via `crypto.subtle`.
  - `fetchAndVerifyXdc(url: string, expectedSha256: string): Promise<Map<string, Uint8Array>>` — throws `XdcIntegrityError` on hash mismatch, `Error('missing index.html')` when absent.
  - `class XdcIntegrityError extends Error`

- [ ] **Step 1: Add dependencies**

```bash
pnpm add fflate smol-toml
```

- [ ] **Step 2: Write the failing test**

```js
/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  unzipXdc, zipXdc, extractXdcMeta, buildManifest, wrapHtml,
  sha256Bytes, fetchAndVerifyXdc, XdcIntegrityError
} from '../xdc-archive.js';

function makeXdc(extra = {}) {
  return zipSync({
    'index.html': strToU8('<html><head></head><body>hi</body></html>'),
    'manifest.toml': strToU8('name = "Test App"'),
    'icon.png': new Uint8Array([137, 80, 78, 71]),
    ...extra
  });
}

afterEach(() => vi.unstubAllGlobals());

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
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
    await expect(fetchAndVerifyXdc('https://x/app.xdc', 'ff'.repeat(32))).rejects.toBeInstanceOf(
      XdcIntegrityError
    );
  });

  it('fetchAndVerifyXdc accepts matching hash and requires index.html', async () => {
    const bytes = makeXdc();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
    const hash = await sha256Bytes(bytes);
    const files = await fetchAndVerifyXdc('https://x/app.xdc', hash);
    expect(files.get('index.html')).toBeTruthy();

    const noIndex = zipSync({ 'manifest.toml': strToU8('name = "x"') });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(noIndex)));
    const h2 = await sha256Bytes(noIndex);
    await expect(fetchAndVerifyXdc('https://x/b.xdc', h2)).rejects.toThrow(/index\.html/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/webxdc/__tests__/xdc-archive.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/lib/webxdc/xdc-archive.js`**

```js
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

/** Wrap a self-contained HTML file into an .xdc file map. */
export function wrapHtml(htmlBytes, name) {
  return new Map([
    ['index.html', htmlBytes],
    ['manifest.toml', new TextEncoder().encode(buildManifest(name))]
  ]);
}

/** @param {Uint8Array} bytes @returns {Promise<string>} hex */
export async function sha256Bytes(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Download an archive, verify its SHA-256 against the published `x` tag
 * (spec requirement — never execute unverified bytes), unzip, require index.html.
 */
export async function fetchAndVerifyXdc(url, expectedSha256) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch package: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const actual = await sha256Bytes(bytes);
  if (expectedSha256 && actual !== expectedSha256.toLowerCase()) {
    throw new XdcIntegrityError(`Package hash mismatch: expected ${expectedSha256}, got ${actual}`);
  }
  const files = unzipXdc(bytes);
  if (!files.get('index.html')) throw new Error('Invalid package: missing index.html');
  return files;
}
```

- [ ] **Step 5: Run test to verify it passes** — expect PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/webxdc/
git commit -m "feat(webxdc): xdc archive handling with integrity verification"
```

---

### Task 3: `subdomain.js` — HMAC-derived sandbox subdomain

**Files:**
- Create: `src/lib/webxdc/subdomain.js`
- Test: `src/lib/webxdc/__tests__/subdomain.test.js`
- Modify: `package.json` (declare `@noble/hashes` as a direct dep — already in the lockfile transitively)

**Interfaces:**
- Produces: `sandboxSubdomain(appKey: string): string` — stable per device+appKey, ≤ 50 chars, `[a-z0-9]` only. Consumed by Task 8.

- [ ] **Step 1: Add dependency**

```bash
pnpm add @noble/hashes@^1
```

- [ ] **Step 2: Write the failing test**

```js
/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { sandboxSubdomain } from '../subdomain.js';

describe('sandboxSubdomain', () => {
  beforeEach(() => localStorage.clear());

  it('is stable for the same appKey and seed', () => {
    expect(sandboxSubdomain('30142:pk:app-1')).toBe(sandboxSubdomain('30142:pk:app-1'));
  });

  it('differs per appKey', () => {
    expect(sandboxSubdomain('a')).not.toBe(sandboxSubdomain('b'));
  });

  it('is a valid DNS label', () => {
    const label = sandboxSubdomain('30142:pk:app-1');
    expect(label).toMatch(/^[a-z0-9]{1,63}$/);
  });

  it('changes when the device seed changes', () => {
    const first = sandboxSubdomain('a');
    localStorage.clear();
    expect(sandboxSubdomain('a')).not.toBe(first);
  });
});
```

- [ ] **Step 3: Run test to verify it fails** — `pnpm vitest run src/lib/webxdc/__tests__/subdomain.test.js` → module not found.

- [ ] **Step 4: Implement `src/lib/webxdc/subdomain.js`**

```js
/**
 * Private, unpredictable sandbox subdomain per app: base36(HMAC-SHA256(seed, appKey)).
 * The seed is device-local so no third party can guess another app's subdomain
 * and reach its origin-keyed storage (iframe.diy security note).
 */
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';

const SEED_KEY = 'edufeed:webxdc-sandbox-seed';
const LABEL_LENGTH = 50; // base36 of 32 bytes, zero-padded; fits the 63-char DNS label limit

function getSeed() {
  try {
    const stored = localStorage.getItem(SEED_KEY);
    if (stored) return stored;
    const seed = globalThis.crypto.randomUUID();
    localStorage.setItem(SEED_KEY, seed);
    return seed;
  } catch {
    return 'edufeed-ephemeral-sandbox-seed'; // private mode fallback: per-session only
  }
}

/** @param {string} appKey @returns {string} */
export function sandboxSubdomain(appKey) {
  const mac = hmac(sha256, new TextEncoder().encode(getSeed()), new TextEncoder().encode(appKey));
  let n = 0n;
  for (const byte of mac) n = (n << 8n) | BigInt(byte);
  return n.toString(36).padStart(LABEL_LENGTH, '0').slice(-LABEL_LENGTH);
}
```

- [ ] **Step 5: Run test to verify it passes** — expect PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/webxdc/subdomain.js src/lib/webxdc/__tests__/subdomain.test.js
git commit -m "feat(webxdc): HMAC-derived sandbox subdomains"
```

---

### Task 4: `sandbox-protocol.js` — iframe.diy fetch responder

**Files:**
- Create: `src/lib/webxdc/sandbox-protocol.js`
- Test: `src/lib/webxdc/__tests__/sandbox-protocol.test.js`

**Interfaces:**
- Produces (consumed by Task 7's `SandboxFrame.svelte`):
  - `WEBXDC_CSP: string` (the Global Constraints CSP, verbatim)
  - `bytesToBase64(bytes: Uint8Array): string`, `utf8ToBase64(text: string): string`
  - `getMimeType(path: string): string`
  - `injectScriptTag(html: string, src: string): string` — inserts `<script src>` after `<head>` (or prepends when no head)
  - `buildFetchResponse(pathname: string, files: Map<string,Uint8Array>, opts: { bridgeScript: string }): { status:number, statusText:string, headers:Record<string,string>, body:string|null }` — serves `/webxdc.js` from `opts.bridgeScript` (shadowing any bundled file), `/` → `index.html`, injects the bridge script tag into every HTML response, adds `Content-Security-Policy: WEBXDC_CSP` to every response, 404 otherwise.

- [ ] **Step 1: Write the failing test**

```js
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  WEBXDC_CSP, bytesToBase64, utf8ToBase64, getMimeType, injectScriptTag, buildFetchResponse
} from '../sandbox-protocol.js';

const enc = (s) => new TextEncoder().encode(s);
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
});

describe('helpers', () => {
  it('base64 round-trips binary', () => {
    expect(bytesToBase64(new Uint8Array([0, 255, 128]))).toBe(btoa(String.fromCharCode(0, 255, 128)));
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
```

- [ ] **Step 2: Run test to verify it fails** — module not found.

- [ ] **Step 3: Implement `src/lib/webxdc/sandbox-protocol.js`**

```js
/**
 * iframe.diy fetch-proxy responder (protocol: JSON-RPC 2.0 over postMessage,
 * base64 bodies — see the public-domain iframe.diy protocol docs). Pure module:
 * SandboxFrame.svelte owns the postMessage wiring; this builds the responses.
 */

export const WEBXDC_CSP =
  "default-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' data: blob:; " +
  "base-uri 'self'; form-action 'self'";

const MIME = {
  html: 'text/html', htm: 'text/html', js: 'application/javascript', mjs: 'application/javascript',
  css: 'text/css', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
  wasm: 'application/wasm', txt: 'text/plain', xml: 'application/xml', vtt: 'text/vtt', csv: 'text/csv'
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
      status: 200, statusText: 'OK',
      headers: { ...headers, 'Content-Type': 'application/javascript' },
      body: utf8ToBase64(opts.bridgeScript)
    };
  }

  const content = files.get(path);
  if (!content) {
    return {
      status: 404, statusText: 'Not Found',
      headers: { ...headers, 'Content-Type': 'text/plain' },
      body: utf8ToBase64('Not Found')
    };
  }

  const mime = getMimeType(path);
  if (mime === 'text/html') {
    const html = injectScriptTag(new TextDecoder().decode(content), '/webxdc.js');
    return { status: 200, statusText: 'OK', headers: { ...headers, 'Content-Type': mime }, body: utf8ToBase64(html) };
  }
  return {
    status: 200, statusText: 'OK',
    headers: { ...headers, 'Content-Type': mime, 'Content-Length': String(content.byteLength) },
    body: bytesToBase64(content)
  };
}
```

- [ ] **Step 4: Run test to verify it passes** — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/webxdc/sandbox-protocol.js src/lib/webxdc/__tests__/sandbox-protocol.test.js
git commit -m "feat(webxdc): iframe.diy fetch responder"
```

---

### Task 5: `local-sync.js` — Phase 1 AppSync backend

**Files:**
- Create: `src/lib/webxdc/local-sync.js`
- Test: `src/lib/webxdc/__tests__/local-sync.test.js`

**Interfaces:**
- Produces the `AppSync` shape (the Phase 2 seam — `community-sync.js` will implement the same):

```js
/**
 * @typedef {Object} AppSync
 * @property {() => Array<{payload:any, info?:string, document?:string, summary?:string}>} getUpdates
 * @property {(payload:any, meta?:{info?:string, document?:string, summary?:string}) => void} sendState
 * @property {(bytes: Uint8Array) => void} sendRealtime
 * @property {(cb: (bytes: Uint8Array) => void) => (() => void)} onRealtime
 * @property {(cb: () => void) => (() => void)} subscribe
 */
```

- `createLocalSync(storageKey: string): AppSync` — consumed by Task 8.

- [ ] **Step 1: Write the failing test**

```js
/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLocalSync } from '../local-sync.js';

describe('createLocalSync', () => {
  beforeEach(() => localStorage.clear());

  it('appends updates in order and notifies subscribers', () => {
    const sync = createLocalSync('webxdc:state:test');
    const changed = vi.fn();
    sync.subscribe(changed);
    sync.sendState({ n: 1 });
    sync.sendState({ n: 2 }, { info: 'two', summary: 'sum' });
    expect(sync.getUpdates().map((u) => u.payload.n)).toEqual([1, 2]);
    expect(sync.getUpdates()[1].info).toBe('two');
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('persists across instances with the same key', () => {
    createLocalSync('webxdc:state:test').sendState({ saved: true });
    expect(createLocalSync('webxdc:state:test').getUpdates()[0].payload.saved).toBe(true);
  });

  it('isolates keys', () => {
    createLocalSync('webxdc:state:a').sendState({ x: 1 });
    expect(createLocalSync('webxdc:state:b').getUpdates()).toEqual([]);
  });

  it('realtime is a no-op without peers but unsubscribes cleanly', () => {
    const sync = createLocalSync('webxdc:state:test');
    const cb = vi.fn();
    const off = sync.onRealtime(cb);
    sync.sendRealtime(new Uint8Array([1]));
    expect(cb).not.toHaveBeenCalled(); // spec: realtime goes to OTHER participants only
    off();
  });

  it('survives corrupted storage', () => {
    localStorage.setItem('webxdc:state:test', '{not json');
    expect(createLocalSync('webxdc:state:test').getUpdates()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — module not found.

- [ ] **Step 3: Implement `src/lib/webxdc/local-sync.js`**

```js
/**
 * Phase 1 AppSync backend: single-participant, durable in localStorage so solo
 * progress (quiz answers, xAPI results) survives reload. Phase 2 swaps in a
 * community-backed implementation of the same interface.
 */

/** @param {string} storageKey @returns {import('./local-sync.js').AppSync} */
export function createLocalSync(storageKey) {
  /** @type {Array<{payload:any, info?:string, document?:string, summary?:string}>} */
  let updates = [];
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) updates = JSON.parse(stored);
    if (!Array.isArray(updates)) updates = [];
  } catch {
    updates = [];
  }

  const subscribers = new Set();

  return {
    getUpdates: () => updates,
    sendState(payload, meta) {
      updates = [...updates, { payload, ...(meta?.info && { info: meta.info }), ...(meta?.document && { document: meta.document }), ...(meta?.summary && { summary: meta.summary }) }];
      try {
        localStorage.setItem(storageKey, JSON.stringify(updates));
      } catch {
        // quota exceeded — state stays in memory for this session
      }
      for (const cb of subscribers) cb();
    },
    sendRealtime() {
      // single participant: realtime frames go to *other* peers, so nothing to do
    },
    onRealtime() {
      return () => {};
    },
    subscribe(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    }
  };
}
```

(Keep the `AppSync` typedef from the Interfaces block as a JSDoc comment at the top of this file — it is the canonical definition Phase 2 imports.)

- [ ] **Step 4: Run test to verify it passes** — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/webxdc/local-sync.js src/lib/webxdc/__tests__/local-sync.test.js
git commit -m "feat(webxdc): localStorage AppSync backend"
```

---

### Task 6: `webxdc-host.js` — bridge script + RPC dispatch

**Files:**
- Create: `src/lib/webxdc/webxdc-host.js`
- Test: `src/lib/webxdc/__tests__/webxdc-host.test.js`

**Interfaces:**
- Consumes: `AppSync` (Task 5).
- Produces (consumed by Task 8):
  - `createWebxdcHost(sync: AppSync, identity: { selfAddr: string, selfName: string }): { bridgeScript: string, handleRpc(method: string, params: any, post: (msg: object) => void): Promise<any>, start(post): () => void }`
  - RPC methods handled: `webxdc.sendUpdate` (65536-byte JSON cap), `webxdc.setUpdateListener` (`{serial}` → replays newer updates as `webxdc.update` notifications, then live), `webxdc.getAllUpdates`, `webxdc.realtimeChannel.join` / `.send` (128000-byte cap) / `.leave`.
  - Notifications posted into the frame: `{jsonrpc:'2.0', method:'webxdc.update', params:{update}}` and `{method:'webxdc.realtimeChannel.data', params:{data:number[]}}`.

- [ ] **Step 1: Write the failing test**

```js
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWebxdcHost } from '../webxdc-host.js';

function fakeSync() {
  const updates = [];
  const subs = new Set();
  const rt = new Set();
  return {
    updates,
    getUpdates: () => updates,
    sendState: vi.fn((payload, meta) => {
      updates.push({ payload, ...meta });
      for (const cb of subs) cb();
    }),
    sendRealtime: vi.fn(),
    onRealtime: (cb) => (rt.add(cb), () => rt.delete(cb)),
    emitRealtime: (bytes) => rt.forEach((cb) => cb(bytes)),
    subscribe: (cb) => (subs.add(cb), () => subs.delete(cb))
  };
}

const identity = { selfAddr: 'npub1abc', selfName: 'Tester' };

describe('createWebxdcHost', () => {
  let sync, host, posts, post;
  beforeEach(() => {
    sync = fakeSync();
    host = createWebxdcHost(sync, identity);
    posts = [];
    post = (msg) => posts.push(msg);
  });

  it('bridgeScript embeds identity and caps', () => {
    expect(host.bridgeScript).toContain('"npub1abc"');
    expect(host.bridgeScript).toContain('"Tester"');
    expect(host.bridgeScript).toContain('window.webxdc');
    expect(host.bridgeScript).toContain('65536');
  });

  it('sendUpdate forwards payload and meta to sync', async () => {
    await host.handleRpc('webxdc.sendUpdate', { update: { payload: { a: 1 }, info: 'i' } }, post);
    expect(sync.sendState).toHaveBeenCalledWith({ a: 1 }, { info: 'i', document: undefined, summary: undefined });
  });

  it('rejects oversized updates', async () => {
    const big = { update: { payload: 'x'.repeat(70000) } };
    await expect(host.handleRpc('webxdc.sendUpdate', big, post)).rejects.toThrow(/65536/);
  });

  it('setUpdateListener replays past updates with serials, then streams live ones', async () => {
    sync.sendState({ n: 1 });
    sync.sendState({ n: 2 });
    host.start(post);
    await host.handleRpc('webxdc.setUpdateListener', { serial: 1 }, post);
    const replayed = posts.filter((p) => p.method === 'webxdc.update');
    expect(replayed).toHaveLength(1);
    expect(replayed[0].params.update).toMatchObject({ payload: { n: 2 }, serial: 2, max_serial: 2 });

    sync.sendState({ n: 3 });
    const live = posts.filter((p) => p.method === 'webxdc.update');
    expect(live.at(-1).params.update).toMatchObject({ payload: { n: 3 }, serial: 3, max_serial: 3 });
  });

  it('getAllUpdates returns serialized updates', async () => {
    sync.sendState({ n: 1 });
    const all = await host.handleRpc('webxdc.getAllUpdates', {}, post);
    expect(all).toEqual([{ payload: { n: 1 }, serial: 1, max_serial: 1 }]);
  });

  it('realtime join/send/leave with cap', async () => {
    await host.handleRpc('webxdc.realtimeChannel.join', {}, post);
    sync.emitRealtime(new Uint8Array([7, 8]));
    expect(posts.at(-1)).toMatchObject({ method: 'webxdc.realtimeChannel.data', params: { data: [7, 8] } });

    await host.handleRpc('webxdc.realtimeChannel.send', { data: [1, 2, 3] }, post);
    expect(sync.sendRealtime).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));

    await expect(
      host.handleRpc('webxdc.realtimeChannel.send', { data: new Array(128001).fill(0) }, post)
    ).rejects.toThrow(/128/);

    await host.handleRpc('webxdc.realtimeChannel.leave', {}, post);
    sync.emitRealtime(new Uint8Array([9]));
    expect(posts.filter((p) => p.method === 'webxdc.realtimeChannel.data')).toHaveLength(1);
  });

  it('unknown method rejects', async () => {
    await expect(host.handleRpc('nope', {}, post)).rejects.toThrow(/unknown/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — module not found.

- [ ] **Step 3: Implement `src/lib/webxdc/webxdc-host.js`**

```js
/**
 * The host side of window.webxdc: maps the webxdc API (spec: webxdc.org) onto
 * an AppSync backend, and generates the bridge script the sandbox serves at
 * /webxdc.js. Serial numbers are assigned by update order (index + 1).
 */

const SEND_UPDATE_MAX_SIZE = 65536;
const REALTIME_MAX_BYTES = 128000;

/**
 * @param {import('./local-sync.js').AppSync} sync
 * @param {{ selfAddr: string, selfName: string }} identity
 */
export function createWebxdcHost(sync, identity) {
  let listenerSerial = null; // null until the app registers a listener
  let realtimeOff = null;

  const serialized = () => {
    const updates = sync.getUpdates();
    return updates.map((u, i) => ({ ...u, serial: i + 1, max_serial: updates.length }));
  };

  function deliverNew(post) {
    if (listenerSerial === null) return;
    for (const update of serialized()) {
      if (update.serial > listenerSerial) {
        listenerSerial = update.serial;
        post({ jsonrpc: '2.0', method: 'webxdc.update', params: { update } });
      }
    }
  }

  return {
    bridgeScript: generateBridgeScript(identity),

    /** Wire live update delivery. Returns an unsubscribe. */
    start(post) {
      return sync.subscribe(() => deliverNew(post));
    },

    async handleRpc(method, params, post) {
      switch (method) {
        case 'webxdc.sendUpdate': {
          const { payload, info, document, summary } = params.update ?? {};
          if (JSON.stringify(payload ?? null).length > SEND_UPDATE_MAX_SIZE) {
            throw new Error(`Update exceeds sendUpdateMaxSize (${SEND_UPDATE_MAX_SIZE})`);
          }
          sync.sendState(payload, { info, document, summary });
          return null;
        }
        case 'webxdc.setUpdateListener': {
          listenerSerial = params?.serial ?? 0;
          deliverNew(post);
          return null;
        }
        case 'webxdc.getAllUpdates':
          return serialized();
        case 'webxdc.realtimeChannel.join': {
          realtimeOff?.();
          realtimeOff = sync.onRealtime((bytes) => {
            post({ jsonrpc: '2.0', method: 'webxdc.realtimeChannel.data', params: { data: [...bytes] } });
          });
          return null;
        }
        case 'webxdc.realtimeChannel.send': {
          const data = params?.data ?? [];
          if (data.length > REALTIME_MAX_BYTES) {
            throw new Error(`Realtime payload exceeds ${REALTIME_MAX_BYTES} byte limit`);
          }
          sync.sendRealtime(Uint8Array.from(data));
          return null;
        }
        case 'webxdc.realtimeChannel.leave': {
          realtimeOff?.();
          realtimeOff = null;
          return null;
        }
        default:
          throw new Error(`Unknown RPC method: ${method}`);
      }
    }
  };
}

/** @param {{ selfAddr: string, selfName: string }} identity */
function generateBridgeScript({ selfAddr, selfName }) {
  return `(function () {
  var nextId = 1;
  var pending = {};
  var updateListener = null;
  var realtimeListener = null;

  function request(method, params) {
    var id = nextId++;
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({ jsonrpc: '2.0', id: id, method: method, params: params }, '*');
    });
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data !== 'object' || data.jsonrpc !== '2.0') return;
    if (data.id !== undefined && !data.method) {
      var p = pending[data.id];
      if (!p) return;
      delete pending[data.id];
      if (data.error) p.reject(new Error(data.error.message));
      else p.resolve(data.result);
      return;
    }
    if (data.method === 'webxdc.update' && updateListener) {
      updateListener(data.params.update);
    } else if (data.method === 'webxdc.realtimeChannel.data' && realtimeListener) {
      realtimeListener(new Uint8Array(data.params.data));
    }
  });

  window.webxdc = {
    selfAddr: ${JSON.stringify(selfAddr)},
    selfName: ${JSON.stringify(selfName)},
    sendUpdateInterval: 1000,
    sendUpdateMaxSize: ${SEND_UPDATE_MAX_SIZE},
    sendUpdate: function (update, descr) {
      request('webxdc.sendUpdate', { update: update, descr: descr });
    },
    setUpdateListener: function (cb, serial) {
      updateListener = cb;
      return request('webxdc.setUpdateListener', { serial: serial || 0 });
    },
    getAllUpdates: function () {
      return request('webxdc.getAllUpdates', {});
    },
    sendToChat: function () {
      return Promise.reject(new Error('sendToChat is not supported'));
    },
    importFiles: function () {
      return Promise.resolve([]);
    },
    joinRealtimeChannel: function () {
      request('webxdc.realtimeChannel.join', {});
      return {
        setListener: function (cb) { realtimeListener = cb; },
        send: function (data) {
          request('webxdc.realtimeChannel.send', { data: Array.prototype.slice.call(data) });
        },
        leave: function () {
          realtimeListener = null;
          request('webxdc.realtimeChannel.leave', {});
        }
      };
    }
  };
})();`;
}
```

- [ ] **Step 4: Run test to verify it passes** — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/webxdc/webxdc-host.js src/lib/webxdc/__tests__/webxdc-host.test.js
git commit -m "feat(webxdc): window.webxdc host and bridge script"
```

---

### Task 7: `SandboxFrame.svelte`

**Files:**
- Create: `src/lib/webxdc/SandboxFrame.svelte`
- Test: `src/lib/components/__tests__/SandboxFrame.test.js`

**Interfaces:**
- Consumes: `buildFetchResponse`, Task 6's `handleRpc` shape, `runtimeConfig.webxdc.sandboxDomain`.
- Produces: component with props `{ id: string, files: Map<string,Uint8Array>, bridgeScript: string, onRpc: (method, params, post) => Promise<any>, onFrameReady?: (post: (msg) => void) => void, class_?: string }`. Consumed by Task 8.

- [ ] **Step 1: Write the failing test** (jsdom can't run a real cross-origin frame; assert the rendered iframe contract — protocol logic is already covered by Tasks 4/6)

```js
// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import SandboxFrame from '../../webxdc/SandboxFrame.svelte';

describe('SandboxFrame', () => {
  const props = {
    id: 'abc123label',
    files: new Map([['index.html', new TextEncoder().encode('<html></html>')]]),
    bridgeScript: 'window.webxdc = {};',
    onRpc: async () => null
  };

  it('renders an iframe on the configured sandbox domain', () => {
    const { container } = render(SandboxFrame, { props });
    const iframe = container.querySelector('iframe');
    expect(iframe.src).toBe('https://abc123label.iframe.diy/');
  });

  it('applies the sandbox attribute without allow-top-navigation', () => {
    const { container } = render(SandboxFrame, { props });
    const sandbox = container.querySelector('iframe').getAttribute('sandbox');
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).toContain('allow-same-origin');
    expect(sandbox).not.toContain('allow-top-navigation');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — component not found.

- [ ] **Step 3: Implement `src/lib/webxdc/SandboxFrame.svelte`**

```svelte
<script>
  /**
   * iframe.diy protocol client. The frame's service worker proxies every
   * same-origin fetch here as JSON-RPC over postMessage; we answer from the
   * in-memory file map. webxdc.* RPC requests are delegated to `onRpc`.
   * Cross-origin subdomain isolation is the primary security boundary; the
   * sandbox attribute is defense-in-depth (no allow-top-navigation).
   */
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { buildFetchResponse } from './sandbox-protocol.js';

  let { id, files, bridgeScript, onRpc, onFrameReady = null, class_ = '' } = $props();

  /** @type {HTMLIFrameElement | undefined} */
  let iframeEl;

  const origin = $derived(`https://${id}.${runtimeConfig.webxdc?.sandboxDomain || 'iframe.diy'}`);

  function post(msg) {
    iframeEl?.contentWindow?.postMessage(msg, origin);
  }

  $effect(() => {
    // Read deps first so the effect re-registers when they change.
    const currentOrigin = origin;
    const currentFiles = files;
    const currentBridge = bridgeScript;
    if (!iframeEl) return;

    /** @param {MessageEvent} event */
    async function onMessage(event) {
      if (event.origin !== currentOrigin) return;
      if (event.source !== iframeEl?.contentWindow) return;
      const msg = event.data;
      if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return;

      if (msg.method === 'ready' && msg.id === undefined) {
        onFrameReady?.(post);
        post({ jsonrpc: '2.0', method: 'init', params: { version: 1 } });
        return;
      }
      if (msg.id === undefined || !msg.method) return;

      if (msg.method === 'fetch') {
        const reqUrl = msg.params?.request?.url;
        try {
          const url = new URL(reqUrl);
          if (url.origin !== currentOrigin) {
            post({ jsonrpc: '2.0', id: msg.id, error: { code: -32003, message: 'Origin mismatch' } });
            return;
          }
          const result = buildFetchResponse(url.pathname, currentFiles, { bridgeScript: currentBridge });
          post({ jsonrpc: '2.0', id: msg.id, result });
        } catch (err) {
          post({ jsonrpc: '2.0', id: msg.id, error: { code: -32002, message: String(err) } });
        }
        return;
      }

      try {
        const result = await onRpc(msg.method, msg.params ?? {}, post);
        post({ jsonrpc: '2.0', id: msg.id, result: result ?? null });
      } catch (err) {
        post({ jsonrpc: '2.0', id: msg.id, error: { code: -1, message: String(err) } });
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  });
</script>

<iframe
  bind:this={iframeEl}
  src={`${origin}/`}
  title="Interactive app"
  class={class_}
  sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"
  allow="autoplay; fullscreen; gamepad; clipboard-write"
></iframe>
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/lib/components/__tests__/SandboxFrame.test.js`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/webxdc/SandboxFrame.svelte src/lib/components/__tests__/SandboxFrame.test.js
git commit -m "feat(webxdc): sandbox iframe protocol client"
```

---

### Task 8: `WebxdcPlayer.svelte`

**Files:**
- Create: `src/lib/webxdc/WebxdcPlayer.svelte`
- Test: `src/lib/components/__tests__/WebxdcPlayer.test.js`
- Modify: `messages/en.json`, `messages/de.json`

**Interfaces:**
- Consumes: Tasks 2, 3, 5, 6, 7; `manager` from `$lib/stores/accounts.svelte`; `nip19` from `nostr-tools`.
- Produces: component `WebxdcPlayer` with props `{ url?: string, sha256?: string, bytes?: Uint8Array|null, name?: string, iconUrl?: string, appKey: string }`. When `bytes` is set (pre-publish preview, Task 11) fetch+verify is skipped. Consumed by Tasks 11 and 14.

- [ ] **Step 1: Add Paraglide messages** to `messages/en.json` and `messages/de.json`:

```json
"webxdc_launch": "Launch",
"webxdc_close": "Close",
"webxdc_fullscreen": "Fullscreen",
"webxdc_loading": "Loading app…",
"webxdc_app_type": "Interactive app",
"webxdc_error_fetch": "The app package could not be downloaded.",
"webxdc_error_integrity": "The downloaded package does not match its published checksum. It was not started.",
"webxdc_error_invalid": "This package is not a valid app (missing index.html).",
"webxdc_error_timeout": "The app did not start in time.",
"webxdc_retry": "Retry"
```

German (`de.json`):

```json
"webxdc_launch": "Starten",
"webxdc_close": "Schließen",
"webxdc_fullscreen": "Vollbild",
"webxdc_loading": "App wird geladen…",
"webxdc_app_type": "Interaktive App",
"webxdc_error_fetch": "Das App-Paket konnte nicht heruntergeladen werden.",
"webxdc_error_integrity": "Das heruntergeladene Paket stimmt nicht mit der veröffentlichten Prüfsumme überein. Es wurde nicht gestartet.",
"webxdc_error_invalid": "Dieses Paket ist keine gültige App (index.html fehlt).",
"webxdc_error_timeout": "Die App ist nicht rechtzeitig gestartet.",
"webxdc_retry": "Erneut versuchen"
```

Note on test assertions: Paraglide's base locale is **German**, so component tests must match either locale (`/Launch|Starten/`), never English-only strings.

- [ ] **Step 2: Write the failing test**

```js
// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { zipSync, strToU8 } from 'fflate';
import WebxdcPlayer from '../../webxdc/WebxdcPlayer.svelte';

vi.mock('$lib/stores/accounts.svelte', () => ({ manager: { active: null } }));

afterEach(() => vi.unstubAllGlobals());

const xdcBytes = zipSync({ 'index.html': strToU8('<html></html>') });

describe('WebxdcPlayer', () => {
  it('renders the launch card with the app name', () => {
    const { getByText } = render(WebxdcPlayer, {
      props: { url: 'https://b/x.xdc', sha256: 'ab', name: 'My Quiz', appKey: 'k' }
    });
    expect(getByText('My Quiz')).toBeTruthy();
    expect(getByText(/Launch|Starten/)).toBeTruthy();
  });

  it('shows the integrity error card on hash mismatch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(xdcBytes)));
    const { getByText, findByText } = render(WebxdcPlayer, {
      props: { url: 'https://b/x.xdc', sha256: 'ff'.repeat(32), name: 'App', appKey: 'k' }
    });
    await fireEvent.click(getByText(/Launch|Starten/));
    expect(await findByText(/checksum|Prüfsumme/)).toBeTruthy();
  });

  it('starts directly from bytes (preview mode) and renders the sandbox frame', async () => {
    const { getByText, container } = render(WebxdcPlayer, {
      props: { bytes: xdcBytes, name: 'Preview', appKey: 'preview:k' }
    });
    await fireEvent.click(getByText(/Launch|Starten/));
    await waitFor(() => expect(container.querySelector('iframe')).toBeTruthy());
  });

  it('errors with retry when the frame never signals ready', async () => {
    vi.useFakeTimers();
    try {
      const { getByText, findByText } = render(WebxdcPlayer, {
        props: { bytes: xdcBytes, name: 'Slow', appKey: 'slow:k' }
      });
      await fireEvent.click(getByText(/Launch|Starten/));
      vi.advanceTimersByTime(16000);
      expect(await findByText(/did not start|nicht rechtzeitig/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails** — component not found.

- [ ] **Step 4: Implement `src/lib/webxdc/WebxdcPlayer.svelte`**

```svelte
<script>
  /**
   * Launch card + sandboxed stage for a webxdc/H5P package. Verifies the
   * archive hash before execution; state persists locally (Phase 1 AppSync).
   */
  import * as m from '$lib/paraglide/messages';
  import { nip19 } from 'nostr-tools';
  import { manager } from '$lib/stores/accounts.svelte';
  import { fetchAndVerifyXdc, unzipXdc, XdcIntegrityError } from './xdc-archive.js';
  import { sandboxSubdomain } from './subdomain.js';
  import { createLocalSync } from './local-sync.js';
  import { createWebxdcHost } from './webxdc-host.js';
  import SandboxFrame from './SandboxFrame.svelte';

  let {
    url = '',
    sha256 = '',
    bytes = null,
    name = '',
    iconUrl = '',
    appKey
  } = $props();

  const READY_TIMEOUT_MS = 15000;

  /** @type {'idle' | 'loading' | 'running' | 'error'} */
  let phase = $state('idle');
  let errorKind = $state(/** @type {'fetch'|'integrity'|'invalid'|'timeout'|null} */ (null));
  let fullscreen = $state(false);
  // Archive + host are plain refs — they never drive template updates directly.
  /** @type {Map<string, Uint8Array> | null} */
  let files = null;
  let host = null;
  let stopHost = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let readyTimer;
  let filesReady = $state(0); // bump to re-render the frame after async load

  const subdomain = $derived(sandboxSubdomain(appKey));

  function identity() {
    const pubkey = manager.active?.pubkey;
    if (!pubkey) return { selfAddr: 'anonymous', selfName: 'Anonymous' };
    const npub = nip19.npubEncode(pubkey);
    return { selfAddr: npub, selfName: npub.slice(0, 12) + '…' };
  }

  async function launch() {
    phase = 'loading';
    errorKind = null;
    try {
      if (bytes) {
        files = unzipXdc(bytes);
        if (!files.get('index.html')) throw new Error('missing index.html');
      } else {
        files = await fetchAndVerifyXdc(url, sha256);
      }
      const sync = createLocalSync(`webxdc:state:${appKey}`);
      host = createWebxdcHost(sync, identity());
      filesReady++;
      phase = 'running';
      // A frame that never completes the ready/init handshake would leave a
      // blank stage — surface it as a retryable error instead.
      clearTimeout(readyTimer);
      readyTimer = setTimeout(() => {
        if (phase === 'running' && !stopHost) {
          close();
          errorKind = 'timeout';
          phase = 'error';
        }
      }, READY_TIMEOUT_MS);
    } catch (err) {
      errorKind =
        err instanceof XdcIntegrityError ? 'integrity'
        : /index\.html/.test(String(err)) ? 'invalid'
        : 'fetch';
      phase = 'error';
    }
  }

  function close() {
    clearTimeout(readyTimer);
    stopHost?.();
    stopHost = null;
    host = null;
    files = null;
    fullscreen = false;
    phase = 'idle';
  }

  function onFrameReady(post) {
    clearTimeout(readyTimer);
    stopHost?.();
    stopHost = host?.start(post) ?? null;
  }
</script>

{#if phase === 'running' && files && host}
  <div class={fullscreen ? 'fixed inset-0 z-50 bg-base-100 flex flex-col' : 'rounded-xl border border-base-300 overflow-hidden'}>
    <div class="flex items-center gap-2 bg-base-200 px-3 py-1.5">
      <span class="text-sm font-semibold truncate flex-1">{name || m.webxdc_app_type()}</span>
      <button class="btn btn-xs" onclick={() => (fullscreen = !fullscreen)}>{m.webxdc_fullscreen()}</button>
      <button class="btn btn-xs" onclick={close}>{m.webxdc_close()}</button>
    </div>
    {#key filesReady}
      <SandboxFrame
        id={subdomain}
        {files}
        bridgeScript={host.bridgeScript}
        onRpc={host.handleRpc}
        {onFrameReady}
        class_={fullscreen ? 'flex-1 w-full' : 'w-full aspect-[4/3]'}
      />
    {/key}
  </div>
{:else if phase === 'error'}
  <div class="rounded-xl border border-error/40 bg-error/5 p-4 text-sm">
    {#if errorKind === 'integrity'}{m.webxdc_error_integrity()}
    {:else if errorKind === 'invalid'}{m.webxdc_error_invalid()}
    {:else if errorKind === 'timeout'}{m.webxdc_error_timeout()}
    {:else}{m.webxdc_error_fetch()}{/if}
    <button class="btn btn-sm mt-2" onclick={launch}>{m.webxdc_retry()}</button>
  </div>
{:else}
  <div class="flex items-center gap-3 rounded-xl border border-base-300 bg-base-100 p-3 max-w-md">
    <div class="size-10 rounded-lg bg-primary/10 overflow-hidden flex items-center justify-center shrink-0">
      {#if iconUrl}<img src={iconUrl} alt="" class="size-full object-cover" />{:else}▦{/if}
    </div>
    <div class="min-w-0 flex-1">
      <p class="text-sm font-semibold truncate">{name || m.webxdc_app_type()}</p>
      <p class="text-xs text-base-content/60">{m.webxdc_app_type()}</p>
    </div>
    <button class="btn btn-sm btn-primary" onclick={launch} disabled={phase === 'loading'}>
      {phase === 'loading' ? m.webxdc_loading() : m.webxdc_launch()}
    </button>
  </div>
{/if}
```

- [ ] **Step 5: Run test to verify it passes** — `pnpm vitest run src/lib/components/__tests__/WebxdcPlayer.test.js`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/webxdc/WebxdcPlayer.svelte src/lib/components/__tests__/WebxdcPlayer.test.js messages/en.json messages/de.json
git commit -m "feat(webxdc): player component with launch card and error states"
```

---

### Task 9: h5p-standalone vendoring + `h5p-wrap.js`

**Files:**
- Create: `scripts/vendor-h5p-standalone.mjs`, `static/h5p-standalone/` (committed output), `src/lib/webxdc/h5p-wrap.js`
- Test: `src/lib/webxdc/__tests__/h5p-wrap.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `buildManifest` (Task 2).
- Produces (consumed by Task 11):
  - `isH5pArchive(files: Map): boolean` — true when `h5p.json` present.
  - `wrapH5p(files: Map<string,Uint8Array>, fallbackName: string): Promise<{ files: Map<string,Uint8Array>, name: string }>` — output layout: `index.html`, `manifest.toml`, `h5p-standalone/{main.bundle.js, frame.bundle.js, styles/h5p.css}` (fetched from `/h5p-standalone/…` static assets), `h5p/<original files>`.

- [ ] **Step 1: Vendor the player**

```bash
pnpm add h5p-standalone
```

Create `scripts/vendor-h5p-standalone.mjs`:

```js
// Copies the pinned h5p-standalone dist into static/ so the client-side
// wrapper can embed it into generated .xdc packages. Re-run after bumping
// the h5p-standalone dependency; output is committed.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/h5p-standalone');
const out = join(root, 'static/h5p-standalone');

mkdirSync(join(out, 'styles'), { recursive: true });
cpSync(join(src, 'dist/main.bundle.js'), join(out, 'main.bundle.js'));
cpSync(join(src, 'dist/frame.bundle.js'), join(out, 'frame.bundle.js'));
cpSync(join(src, 'dist/styles/h5p.css'), join(out, 'styles/h5p.css'));
cpSync(join(src, 'LICENSE'), join(out, 'LICENSE'));
console.log('h5p-standalone vendored to static/h5p-standalone');
```

Run it and commit the output: `node scripts/vendor-h5p-standalone.mjs` (if the `dist/` file names differ in the installed version, `ls node_modules/h5p-standalone/dist` and adjust — the three assets are the main bundle, the frame bundle, and the frame CSS).

- [ ] **Step 2: Write the failing test**

```js
/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { strToU8 } from 'fflate';
import { isH5pArchive, wrapH5p } from '../h5p-wrap.js';

afterEach(() => vi.unstubAllGlobals());

function fakeH5p() {
  return new Map([
    ['h5p.json', strToU8(JSON.stringify({ title: 'Peace Quiz', mainLibrary: 'H5P.QuestionSet' }))],
    ['content/content.json', strToU8('{}')],
    ['H5P.QuestionSet-1.20/library.json', strToU8('{}')]
  ]);
}

function stubAssets() {
  vi.stubGlobal('fetch', vi.fn(async (url) => new Response(`/* asset ${url} */`)));
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

  it('falls back to the provided name when h5p.json is unreadable', async () => {
    stubAssets();
    const broken = new Map([['h5p.json', strToU8('{oops')]]);
    const { name } = await wrapH5p(broken, 'My Upload');
    expect(name).toBe('My Upload');
  });
});
```

- [ ] **Step 3: Run test to verify it fails** — module not found.

- [ ] **Step 4: Implement `src/lib/webxdc/h5p-wrap.js`**

```js
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
```

- [ ] **Step 5: Run test to verify it passes** — expect PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml scripts/vendor-h5p-standalone.mjs static/h5p-standalone src/lib/webxdc/h5p-wrap.js src/lib/webxdc/__tests__/h5p-wrap.test.js
git commit -m "feat(webxdc): h5p-standalone vendoring and .h5p wrapper"
```

---

### Task 10: Dual-purpose 1063 — `alt`/`image` on license attestations

**Files:**
- Modify: `src/lib/helpers/image-license.js` (`buildLicenseTemplate`, line 28)
- Modify: `src/lib/components/shared/LicenseModal.svelte` (new `attestExtras` prop)
- Test: `src/lib/__tests__/image-license.test.js` (extend)

**Interfaces:**
- Consumes: existing `buildLicenseTemplate(input)` / `publishLicenseAttestation(input, signer)` (which passes `input` straight through to the builder).
- Produces: `buildLicenseTemplate` accepts optional `alt?: string` and `image?: string`; emits `['alt', alt]` and `['image', image]` tags after `credit`. `LicenseModal` gains prop `attestExtras: { alt?: string, image?: string } | null` spread into the attestation input on save. `publishLicenseAttestation` routes webxdc attestations (`input.mime === 'application/x-webxdc'`) to the educational relays via `additionalRelays`, so Armada-style pickers querying the AMB relays find them. Consumed by Task 11.

- [ ] **Step 1: Write the failing tests** — append to `src/lib/__tests__/image-license.test.js`:

```js
describe('buildLicenseTemplate NIP-DC extras', () => {
  const base = {
    hash: 'ab'.repeat(32),
    url: 'https://blossom/x.xdc',
    mime: 'application/x-webxdc',
    license: 'https://creativecommons.org/licenses/by/4.0/',
    credit: 'Jane Doe'
  };

  it('emits alt and image tags when provided', () => {
    const t = buildLicenseTemplate({ ...base, alt: 'Webxdc app: Quiz', image: 'https://blossom/icon.png' });
    expect(t.tags).toContainEqual(['alt', 'Webxdc app: Quiz']);
    expect(t.tags).toContainEqual(['image', 'https://blossom/icon.png']);
  });

  it('omits them when absent', () => {
    const t = buildLicenseTemplate(base);
    expect(t.tags.some(([n]) => n === 'alt' || n === 'image')).toBe(false);
  });
});
```

Also add a routing test (in the same file, alongside the existing `publishLicenseAttestation` mocks — copy the mock preamble from `src/lib/__tests__/publishLicenseAttestation.test.js` if that suite is separate, and put the test there instead):

```js
it('publishes webxdc attestations to the educational relays', async () => {
  // with getEducationalRelays mocked to ['wss://amb.test/']
  await publishLicenseAttestation({ ...base, mime: 'application/x-webxdc' }, signer);
  expect(publishEventOptimistic).toHaveBeenCalledWith(
    expect.anything(),
    [],
    expect.objectContaining({ additionalRelays: ['wss://amb.test/'] })
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/image-license.test.js`
Expected: new describe block FAILS.

- [ ] **Step 3: Implement**

In `buildLicenseTemplate` (`image-license.js`), destructure `alt` and `image` from `input` and, directly after the `['credit', credit]` push:

```js
  if (alt) tags.push(['alt', alt]);
  if (image) tags.push(['image', image]);
```

Update the function's JSDoc `input` typedef with `alt?` ("NIP-94/NIP-DC alt text, e.g. `Webxdc app: <name>`") and `image?` ("icon/preview URL").

In `LicenseModal.svelte`: add to `$props()`:

```js
    /**
     * Extra NIP-94 fields spread into the kind-1063 attestation (NIP-DC
     * discovery: alt + icon for webxdc packages). Null for plain images.
     * @type {{ alt?: string, image?: string } | null}
     */
    attestExtras = null,
```

Find the single `publishLicenseAttestation(` call in the modal's save handler and spread the extras into its first argument: `publishLicenseAttestation({ ...<existing input object>, ...(attestExtras ?? {}) }, <existing signer arg>)`.

In `publishLicenseAttestation` (`image-license.js:129`), route webxdc packages to the educational relays so NIP-DC pickers (which query the AMB relays) discover them — replace the final publish call with:

```js
  const additionalRelays =
    input.mime === 'application/x-webxdc' ? getEducationalRelays() : [];
  publishEventOptimistic(signed, [], { additionalRelays });
```

adding `import { getEducationalRelays } from '$lib/helpers/relay-helper.js';` at the top (relay-helper respects gated mode + user overrides per CLAUDE.md).

- [ ] **Step 4: Run test to verify it passes**, then run the full existing suites for the touched code:

```bash
pnpm vitest run src/lib/__tests__/image-license.test.js src/lib/__tests__/publishLicenseAttestation.test.js src/lib/components/__tests__/LicensedFileInput.test.js
```

Expected: all PASS (extension is additive).

- [ ] **Step 5: Commit**

```bash
git add src/lib/helpers/image-license.js src/lib/components/shared/LicenseModal.svelte src/lib/__tests__/image-license.test.js
git commit -m "feat(webxdc): alt/image extras on kind-1063 license attestations"
```

---

### Task 11: `InteractivePackageInput.svelte`

**Files:**
- Create: `src/lib/components/educational/InteractivePackageInput.svelte`
- Test: `src/lib/components/__tests__/InteractivePackageInput.test.js`
- Modify: `messages/en.json`, `messages/de.json`

**Interfaces:**
- Consumes: Tasks 2, 8 (preview via `bytes`), 9, 10; `LicenseModal` (`beforeAttest`, `attestExtras`, `onsave`); `getActiveBlossomServer` + `BlossomClient` + `reconcileBlobUrlScheme` (same pattern as `LicensedFileInput.svelte:388-391`); `findExistingLicense`.
- Produces: component with props `{ value?: object|null (bindable), disabled?: boolean, activeUserDisplayName?: string }`. `value` shape (what Task 12 maps into the wizard):

```js
/** @typedef {{ url: string, name: string, type: 'application/x-webxdc', size: number,
 *   sha256: string, licenseEvent: any, iconUrl: string }} InteractivePackage */
```

- [ ] **Step 1: Add Paraglide messages** (en / de):

```json
"interactive_input_label": "App package (.h5p, .xdc or .html)",
"interactive_input_help": "H5P exports are wrapped automatically. The package runs fully offline in a sandbox.",
"interactive_input_invalid": "This file is not a valid package (no index.html found).",
"interactive_input_too_large": "This package is larger than 50 MB — it will be slow to launch.",
"interactive_input_preview": "Preview",
"interactive_input_replace": "Replace package"
```

```json
"interactive_input_label": "App-Paket (.h5p, .xdc oder .html)",
"interactive_input_help": "H5P-Exporte werden automatisch verpackt. Das Paket läuft vollständig offline in einer Sandbox.",
"interactive_input_invalid": "Diese Datei ist kein gültiges Paket (keine index.html gefunden).",
"interactive_input_too_large": "Dieses Paket ist größer als 50 MB — der Start wird langsam sein.",
"interactive_input_preview": "Vorschau",
"interactive_input_replace": "Paket ersetzen"
```

- [ ] **Step 2: Write the failing test**

```js
// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { zipSync, strToU8 } from 'fflate';
import InteractivePackageInput from '../educational/InteractivePackageInput.svelte';

vi.mock('$lib/helpers/image-license.js', async (importOriginal) => ({
  ...(await importOriginal()),
  findExistingLicense: vi.fn(async () => null)
}));
vi.mock('$lib/services/blossom-settings-service.js', () => ({
  getActiveBlossomServer: () => 'https://blossom.test'
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: { pubkey: 'pk', signEvent: vi.fn() } }
}));

function pick(container, file) {
  const input = container.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { value: [file] });
  return fireEvent.change(input);
}

describe('InteractivePackageInput', () => {
  it('wraps an html file and reaches the pending/license state', async () => {
    const { container, findByText } = render(InteractivePackageInput, { props: { value: null } });
    await pick(container, new File(['<p>hi</p>'], 'quiz.html', { type: 'text/html' }));
    // License modal opens for the wrapped package (its file name shows the .xdc)
    expect(await findByText(/quiz\.xdc/)).toBeTruthy();
  });

  it('rejects an .xdc without index.html', async () => {
    const bad = zipSync({ 'manifest.toml': strToU8('name = "x"') });
    const { container, findByText } = render(InteractivePackageInput, { props: { value: null } });
    await pick(container, new File([bad], 'broken.xdc'));
    expect(await findByText(/index\.html/)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails** — component not found.

- [ ] **Step 4: Implement `src/lib/components/educational/InteractivePackageInput.svelte`**

```svelte
<script>
  /**
   * Step-2 field of the `interactive` resource variant. Normalizes any upload
   * (.h5p / .xdc / .html) into a .xdc, defers the Blossom upload to the
   * license modal's beforeAttest (same pattern as LicensedFileInput), uploads
   * the extracted icon alongside, and publishes ONE kind-1063 that is both
   * license attestation and NIP-DC discovery event (m=application/x-webxdc,
   * alt, image).
   */
  import * as m from '$lib/paraglide/messages';
  import { BlossomClient } from 'blossom-client-sdk';
  import LicenseModal from '$lib/components/shared/LicenseModal.svelte';
  import WebxdcPlayer from '$lib/webxdc/WebxdcPlayer.svelte';
  import { manager } from '$lib/stores/accounts.svelte';
  import { getActiveBlossomServer } from '$lib/services/blossom-settings-service.js';
  import { reconcileBlobUrlScheme } from '$lib/helpers/blossom-trust.js';
  import { findExistingLicense } from '$lib/helpers/image-license.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { unzipXdc, zipXdc, extractXdcMeta, wrapHtml, sha256Bytes } from '$lib/webxdc/xdc-archive.js';
  import { isH5pArchive, wrapH5p } from '$lib/webxdc/h5p-wrap.js';

  const SIZE_WARN_BYTES = 50 * 1024 * 1024;

  let { value = $bindable(null), disabled = false, activeUserDisplayName = '' } = $props();

  let error = $state('');
  let sizeWarning = $state(false);
  let busy = $state(false);
  let modalOpen = $state(false);
  let showPreview = $state(false);

  // Pending package between file selection and license save. Plain refs +
  // small $state mirrors for the bits the template shows.
  /** @type {{ file: File, bytes: Uint8Array, sha256: string, name: string,
   *    iconBytes: Uint8Array|null, iconMime: string|null } | null} */
  let pending = null;
  let pendingName = $state('');
  let pendingFileName = $state('');
  let pendingHash = $state('');
  let pendingSize = $state(0);
  let existingLicense = $state(null);
  let iconUrl = $state('');
  let pendingBytes = $state.raw(/** @type {Uint8Array|null} */ (null));

  function stripExt(fileName) {
    return fileName.replace(/\.(h5p|xdc|html?)$/i, '');
  }

  /** @param {Event} e */
  async function onFileChange(e) {
    const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
    if (!file) return;
    error = '';
    sizeWarning = false;
    busy = true;
    try {
      const inputBytes = new Uint8Array(await file.arrayBuffer());
      const lower = file.name.toLowerCase();
      let files;
      let name = stripExt(file.name);

      if (lower.endsWith('.html') || lower.endsWith('.htm')) {
        files = wrapHtml(inputBytes, name);
      } else {
        const unzipped = unzipXdc(inputBytes);
        if (isH5pArchive(unzipped)) {
          const wrapped = await wrapH5p(unzipped, name);
          files = wrapped.files;
          name = wrapped.name;
        } else {
          files = unzipped;
          const meta = extractXdcMeta(files);
          if (meta.name) name = meta.name;
        }
      }

      if (!files.get('index.html')) {
        error = m.interactive_input_invalid();
        return;
      }

      const meta = extractXdcMeta(files);
      const xdcBytes = zipXdc(files);
      const hash = await sha256Bytes(xdcBytes);
      sizeWarning = xdcBytes.byteLength > SIZE_WARN_BYTES;

      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';
      pending = {
        file: new File([xdcBytes], `${slug}.xdc`, { type: 'application/x-webxdc' }),
        bytes: xdcBytes,
        sha256: hash,
        name,
        iconBytes: meta.iconBytes,
        iconMime: meta.iconMime
      };
      pendingName = name;
      pendingFileName = pending.file.name;
      pendingHash = hash;
      pendingSize = xdcBytes.byteLength;
      pendingBytes = xdcBytes;
      iconUrl = '';
      existingLicense = await findExistingLicense(hash);
      modalOpen = true;
    } catch (err) {
      error = m.interactive_input_invalid();
      console.error('Package processing failed:', err);
    } finally {
      busy = false;
      /** @type {HTMLInputElement} */ (e.target).value = '';
    }
  }

  /** Deferred upload: package + icon, run when the license modal saves. */
  async function beforeAttest() {
    const activeUser = manager.active;
    if (!pending || !activeUser?.pubkey) throw new Error('No pending package or user');
    const signerFn = async (ev) => activeUser.signEvent(ev);
    const serverUrl = getActiveBlossomServer(activeUser.pubkey, eventStore);
    const client = new BlossomClient(serverUrl, signerFn);

    if (pending.iconBytes) {
      const iconFile = new File([pending.iconBytes], pending.iconMime === 'image/jpeg' ? 'icon.jpg' : 'icon.png', {
        type: pending.iconMime ?? 'image/png'
      });
      const iconBlob = await client.uploadBlob(iconFile);
      iconUrl = reconcileBlobUrlScheme(iconBlob.url, serverUrl);
    }

    const blob = await client.uploadBlob(pending.file);
    const finalUrl = reconcileBlobUrlScheme(blob.url, serverUrl);
    return { url: finalUrl, hash: blob.sha256, mime: 'application/x-webxdc', size: blob.size ?? pending.file.size };
  }

  function onLicenseSaved(licenseEvent) {
    if (!pending) return;
    const url = licenseEvent.tags.find((t) => t[0] === 'url')?.[1] ?? '';
    value = {
      url,
      name: pending.name,
      type: 'application/x-webxdc',
      size: pending.file.size,
      sha256: pending.sha256,
      licenseEvent,
      iconUrl
    };
    modalOpen = false;
  }
</script>

<div class="space-y-2">
  <label class="label"><span class="label-text">{m.interactive_input_label()}</span></label>
  {#if value}
    <div class="flex items-center gap-3 rounded-xl border border-base-300 p-3">
      {#if value.iconUrl}<img src={value.iconUrl} alt="" class="size-9 rounded-lg object-cover" />{/if}
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold truncate">{value.name}</p>
        <p class="text-xs text-base-content/60">{(value.size / 1024 / 1024).toFixed(1)} MB</p>
      </div>
      <button type="button" class="btn btn-sm" onclick={() => (showPreview = !showPreview)}>{m.interactive_input_preview()}</button>
      <button type="button" class="btn btn-sm" onclick={() => { value = null; pendingBytes = null; }} {disabled}>{m.interactive_input_replace()}</button>
    </div>
    {#if showPreview && pendingBytes}
      <WebxdcPlayer bytes={pendingBytes} name={value.name} appKey={`preview:${value.sha256}`} />
    {/if}
  {:else}
    <input
      type="file"
      class="file-input file-input-bordered w-full"
      accept=".h5p,.xdc,.html,.htm,text/html,application/x-webxdc"
      onchange={onFileChange}
      disabled={disabled || busy}
    />
    <p class="text-xs text-base-content/60">{m.interactive_input_help()}</p>
  {/if}
  {#if error}<p class="text-sm text-error">{error}</p>{/if}
  {#if sizeWarning}<p class="text-sm text-warning">{m.interactive_input_too_large()}</p>{/if}
</div>

<LicenseModal
  bind:open={modalOpen}
  hash={pendingHash}
  url=""
  mime="application/x-webxdc"
  size={pendingSize}
  fileName={pendingFileName}
  {activeUserDisplayName}
  {existingLicense}
  {beforeAttest}
  attestExtras={{ alt: `Webxdc app: ${pendingName}`, image: iconUrl }}
  onsave={onLicenseSaved}
  oncancel={() => (modalOpen = false)}
/>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/components/__tests__/InteractivePackageInput.test.js`
Expected: PASS. If the LicenseModal mock surface differs (e.g. it needs additional stores mocked), stub `LicenseModal` in the test via `vi.mock('$lib/components/shared/LicenseModal.svelte')` with a component rendering `{fileName}` — the assertion stays the same.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/educational/InteractivePackageInput.svelte src/lib/components/__tests__/InteractivePackageInput.test.js messages/en.json messages/de.json
git commit -m "feat(webxdc): interactive package upload field"
```

---

### Task 12: Variant registration, wizard wiring, publish tags

**Files:**
- Modify: `src/lib/config/resource-form-variants.js` (`ALL_VARIANTS`, line 43)
- Modify: `messages/en.json`, `messages/de.json`
- Modify: `.env.example` (RESOURCE_FORM_VARIANTS docs, ~line 311)
- Modify: `src/lib/helpers/educational/eventTags.js` (new `appendInteractiveTags`)
- Modify: `src/lib/stores/educational-actions.svelte.js` (tag assembly, lines 258–283)
- Modify: `src/lib/helpers/educational/validateWizardStep.js` (case 2, line ~58)
- Modify: `src/lib/components/educational/ResourceFormWizard.svelte` (step 2 block at line 1821, validate call sites)
- Test: `src/lib/helpers/educational/__tests__/interactiveVariant.test.js`

**Interfaces:**
- Consumes: `InteractivePackageInput` (Task 11), existing `appendVariantLabelTags`, `buildResourceData` (`files: formData.encodings`, line 86), `validateWizardStep(step, formData, ctx, subStepConfig)`.
- Produces:
  - Variant id `'interactive'` (NIP-32 label value; also the route segment `/create/resource/interactive`).
  - `appendInteractiveTags(tags: string[][], files: Array<{type?:string, sha256?:string}>): void` — pushes `['m','application/x-webxdc']` + `['x', sha256]` when an x-webxdc file is present.
  - Wizard contract: for the interactive variant, the package lands in `formData.encodings` (`UploadedFileWithLicense` shape) and `formData.identifier` = package URL.
  - `ctx.variantId` added to the `validateWizardStep` context object.

- [ ] **Step 1: Write the failing test**

```js
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { appendInteractiveTags } from '../../eventTags.js';
import { validateWizardStep } from '../../validateWizardStep.js';
import { ALL_VARIANTS } from '../../../../config/resource-form-variants.js';

describe('interactive variant registration', () => {
  it('is registered with label keys', () => {
    const v = ALL_VARIANTS.find((v) => v.id === 'interactive');
    expect(v).toBeTruthy();
    expect(v.labelKey).toBe('resource_form_variant_interactive_label');
  });
});

describe('appendInteractiveTags', () => {
  it('adds m and x tags for an x-webxdc file', () => {
    const tags = [];
    appendInteractiveTags(tags, [{ type: 'application/x-webxdc', sha256: 'aa' }]);
    expect(tags).toContainEqual(['m', 'application/x-webxdc']);
    expect(tags).toContainEqual(['x', 'aa']);
  });

  it('does nothing without one', () => {
    const tags = [];
    appendInteractiveTags(tags, [{ type: 'application/pdf', sha256: 'bb' }]);
    appendInteractiveTags(tags, undefined);
    expect(tags).toEqual([]);
  });
});

describe('validateWizardStep interactive step 2', () => {
  const ctx = { hasNoUrl: false, isEditMode: false, isValidUrl: () => true, variantId: 'interactive' };

  it('requires a licensed package', () => {
    const errors = validateWizardStep(2, { encodings: [] }, ctx);
    expect(errors.attachments).toBeTruthy();
  });

  it('passes with a licensed x-webxdc encoding and set identifier', () => {
    const formData = {
      identifier: 'https://blossom/x.xdc',
      encodings: [{ type: 'application/x-webxdc', sha256: 'aa', licenseEvent: { id: 'e' } }]
    };
    expect(validateWizardStep(2, formData, ctx)).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/helpers/educational/__tests__/interactiveVariant.test.js`
Expected: FAIL (`appendInteractiveTags` not exported, no variant, validation missing).

- [ ] **Step 3: Implement**

`resource-form-variants.js` — append to `ALL_VARIANTS`:

```js
  {
    id: 'interactive',
    labelKey: 'resource_form_variant_interactive_label',
    descriptionKey: 'resource_form_variant_interactive_description',
    bildungsbereichKeys: ['schule', 'hochschule', 'extra']
  }
```

Messages (en):

```json
"resource_form_variant_interactive_label": "Interactive app (H5P)",
"resource_form_variant_interactive_description": "Upload an H5P exercise, webxdc app or self-contained HTML — it runs directly in a sandbox."
```

(de):

```json
"resource_form_variant_interactive_label": "Interaktive App (H5P)",
"resource_form_variant_interactive_description": "Lade eine H5P-Übung, webxdc-App oder eigenständige HTML-Datei hoch — sie läuft direkt in einer Sandbox."
```

`.env.example`: extend the `RESOURCE_FORM_VARIANTS` comment to mention `interactive`.

`eventTags.js` — new export next to `appendExternalUrlTags`:

```js
/**
 * Interactive (webxdc) resources: mark the event launchable and pin the
 * package hash for execution-time integrity verification (NIP-DC).
 * @param {string[][]} tags
 * @param {Array<{type?: string, sha256?: string}> | undefined} files
 */
export function appendInteractiveTags(tags, files) {
  const pkg = (files ?? []).find((f) => f.type === 'application/x-webxdc');
  if (!pkg) return;
  tags.push(['m', 'application/x-webxdc']);
  if (pkg.sha256) tags.push(['x', pkg.sha256]);
}
```

`educational-actions.svelte.js` — import `appendInteractiveTags` alongside the other `eventTags.js` imports and call it in the tag-assembly sequence (both create and update paths, right after `appendVariantLabelTags(tags, variantId)`):

```js
      appendInteractiveTags(tags, formData.files);
```

(`formData` here is the `buildResourceData` output, whose `files` field is the wizard's `encodings` — see `buildResourceData.js:86`.)

`validateWizardStep.js` — inside `case 2`, before the existing checks:

```js
      if (ctx.variantId === 'interactive') {
        const pkg = (formData.encodings ?? []).find((f) => f.type === 'application/x-webxdc');
        if (!pkg || !pkg.licenseEvent) errors.attachments = m.noUrlNeedsFile();
        break;
      }
```

`ResourceFormWizard.svelte`:
- Pass `variantId` into every `validateWizardStep(...)` ctx object (grep the call sites in the file; add `variantId` to the ctx literal).
- In the step-2 block (line 1821 region), branch on the variant:

```svelte
      {#if variantId === 'interactive'}
        <InteractivePackageInput bind:value={interactivePackage} activeUserDisplayName={activeUserDisplayName} />
      {:else}
        <!-- existing step-2 content (URL input / LicensedFileInput) unchanged -->
      {/if}
```

- Add the mapping state + effect near the other wizard state:

```js
  /** Interactive-variant package (maps onto encodings + identifier). */
  let interactivePackage = $state(null);
  $effect(() => {
    if (variantId !== 'interactive') return;
    if (interactivePackage) {
      formData.encodings = [
        {
          url: interactivePackage.url,
          name: interactivePackage.name,
          type: interactivePackage.type,
          size: interactivePackage.size,
          sha256: interactivePackage.sha256,
          licenseEvent: interactivePackage.licenseEvent
        }
      ];
      formData.identifier = interactivePackage.url;
    } else {
      formData.encodings = [];
    }
  });
```

- Edit-mode rehydration: where the wizard initializes `formData` from `editResource`, when `variantId === 'interactive'` seed `interactivePackage` from the existing x-webxdc encoding (`editResource.encodings.find(e => e.mimeType === 'application/x-webxdc')`, mapping `{url, name, type: 'application/x-webxdc', size, sha256, licenseEvent: null, iconUrl: ''}`).

- [ ] **Step 4: Run tests**

```bash
pnpm vitest run src/lib/helpers/educational/__tests__/interactiveVariant.test.js src/lib/__tests__/validateWizardStep.test.js src/lib/__tests__/buildResourceData.test.js
```

Expected: all PASS (existing validate tests keep passing — the new branch only fires for `ctx.variantId === 'interactive'`).

- [ ] **Step 5: Manual smoke** — `pnpm run dev`, open `/create/resource/interactive` (add `interactive` to `RESOURCE_FORM_VARIANTS` in the worktree `.env`), upload a small `.html`, complete license modal, publish; verify the published event (network tab / relay) carries `['m','application/x-webxdc']`, `['x', …]`, `['l','interactive','metadata-form']`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/config/resource-form-variants.js src/lib/helpers/educational/eventTags.js src/lib/stores/educational-actions.svelte.js src/lib/helpers/educational/validateWizardStep.js src/lib/components/educational/ResourceFormWizard.svelte src/lib/helpers/educational/__tests__/interactiveVariant.test.js messages/en.json messages/de.json .env.example
git commit -m "feat(webxdc): interactive resource form variant with m/x publish tags"
```

---

### Task 13: "Interactive" badge on `AMBResourceCard`

**Files:**
- Modify: `src/lib/components/educational/AMBResourceCard.svelte`
- Modify: `messages/en.json`, `messages/de.json`
- Test: `src/lib/components/__tests__/AMBResourceCardInteractive.test.js`

**Interfaces:**
- Consumes: `resource.encodings` (from `formatAMBResource`, entries `{url, mimeType, size, sha256, name}`).

- [ ] **Step 1: Messages** — en: `"interactive_badge": "Interactive"`, de: `"interactive_badge": "Interaktiv"`.

- [ ] **Step 2: Write the failing test**

```js
// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import AMBResourceCard from '../educational/AMBResourceCard.svelte';

const base = {
  id: 'id1', identifier: 'https://x', pubkey: 'pk', created_at: 1, kind: 30142,
  name: 'Quiz', description: '', image: '', types: [], learningResourceTypes: [],
  subjects: [], educationalLevels: [], keywords: [], languages: [], license: '',
  isFree: true, publishedDate: '', creatorNames: [], resourceURLs: [], primaryURL: '',
  encodings: [], externalUrl: '', externalUrls: [], tags: [], rawEvent: { tags: [] }
};

describe('AMBResourceCard interactive badge', () => {
  it('shows the badge for x-webxdc encodings', () => {
    const resource = { ...base, encodings: [{ url: 'u', mimeType: 'application/x-webxdc', sha256: 'aa' }] };
    const { getByText } = render(AMBResourceCard, { props: { resource } });
    expect(getByText(/Interactive|Interaktiv/)).toBeTruthy();
  });

  it('hides it otherwise', () => {
    const { queryByText } = render(AMBResourceCard, { props: { resource: base } });
    expect(queryByText(/Interactive|Interaktiv/)).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails.**

- [ ] **Step 4: Implement** — in `AMBResourceCard.svelte`, next to the existing deriveds:

```js
  const isInteractive = $derived(
    (resource?.encodings ?? []).some((e) => e.mimeType === 'application/x-webxdc')
  );
```

and render, adjacent to the existing type/metadata chips (both card and list variants):

```svelte
  {#if isInteractive}
    <span class="badge badge-sm badge-primary">{m.interactive_badge()}</span>
  {/if}
```

- [ ] **Step 5: Run test to verify it passes** (if the card requires additional store mocks to render, copy the mock preamble from an existing AMBResourceCard test in `src/lib/components/__tests__/`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/educational/AMBResourceCard.svelte src/lib/components/__tests__/AMBResourceCardInteractive.test.js messages/en.json messages/de.json
git commit -m "feat(webxdc): interactive badge on resource cards"
```

---

### Task 14: Player in `AMBResourceView` + companion-1063 deletion

**Files:**
- Modify: `src/lib/components/educational/AMBResourceView.svelte` (uploaded-files section ~line 894, delete flow ~line 170)
- Create: `src/lib/helpers/educational/interactiveResource.js`
- Test: `src/lib/helpers/educational/__tests__/interactiveResource.test.js`

**Interfaces:**
- Consumes: `WebxdcPlayer` (Task 8), `useLicenseForHash` (`$lib/stores/image-license.svelte.js`), `findExistingLicense`, `deleteEvent` (`$lib/helpers/eventDeletion.js`).
- Produces:
  - `findInteractiveEncoding(resource): {url, mimeType, sha256, name}|null`
  - `resourceAppKey(event): string` — `"<kind>:<pubkey>:<dTag>"`
  - `deleteCompanionLicense(sha256, activeUser): Promise<void>` — deletes the user's own kind-1063 for the hash (best-effort; never throws).

- [ ] **Step 1: Write the failing test**

```js
/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/helpers/image-license.js', () => ({ findExistingLicense: vi.fn() }));
vi.mock('$lib/helpers/eventDeletion.js', () => ({ deleteEvent: vi.fn(async () => ({ success: true })) }));

import { findInteractiveEncoding, resourceAppKey, deleteCompanionLicense } from '../interactiveResource.js';
import { findExistingLicense } from '$lib/helpers/image-license.js';
import { deleteEvent } from '$lib/helpers/eventDeletion.js';

describe('findInteractiveEncoding', () => {
  it('returns the x-webxdc encoding', () => {
    const resource = { encodings: [{ mimeType: 'application/pdf' }, { mimeType: 'application/x-webxdc', sha256: 'aa' }] };
    expect(findInteractiveEncoding(resource)?.sha256).toBe('aa');
    expect(findInteractiveEncoding({ encodings: [] })).toBeNull();
    expect(findInteractiveEncoding(null)).toBeNull();
  });
});

describe('resourceAppKey', () => {
  it('builds kind:pubkey:d', () => {
    const event = { kind: 30142, pubkey: 'pk', tags: [['d', 'https://x/app.xdc']] };
    expect(resourceAppKey(event)).toBe('30142:pk:https://x/app.xdc');
  });
});

describe('deleteCompanionLicense', () => {
  const user = { pubkey: 'me', signEvent: vi.fn() };

  it('deletes an own license event', async () => {
    const lic = { id: 'l1', kind: 1063, pubkey: 'me' };
    findExistingLicense.mockResolvedValueOnce(lic);
    await deleteCompanionLicense('aa', user);
    expect(deleteEvent).toHaveBeenCalledWith(lic, user);
  });

  it('skips foreign or missing license events and swallows errors', async () => {
    findExistingLicense.mockResolvedValueOnce({ id: 'l2', pubkey: 'other' });
    await deleteCompanionLicense('aa', user);
    findExistingLicense.mockRejectedValueOnce(new Error('relay down'));
    await expect(deleteCompanionLicense('aa', user)).resolves.toBeUndefined();
    expect(deleteEvent).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — module not found.

- [ ] **Step 3: Implement `src/lib/helpers/educational/interactiveResource.js`**

```js
/**
 * Helpers for interactive (webxdc) AMB resources: locating the package
 * encoding, deriving the stable per-app key, and cleaning up the companion
 * kind-1063 discovery/license event on delete.
 */
import { findExistingLicense } from '$lib/helpers/image-license.js';
import { deleteEvent } from '$lib/helpers/eventDeletion.js';

/** @param {{encodings?: Array<{mimeType?: string}>} | null} resource */
export function findInteractiveEncoding(resource) {
  return resource?.encodings?.find((e) => e.mimeType === 'application/x-webxdc') ?? null;
}

/** Stable addressable key for sandbox subdomain + local state storage. */
export function resourceAppKey(event) {
  const dTag = event.tags?.find((t) => t[0] === 'd')?.[1] || '';
  return `${event.kind}:${event.pubkey}:${dTag}`;
}

/**
 * Delete the user's own kind-1063 for the package hash (NIP-DC discovery +
 * license attestation). Best-effort: a failure must never block the main
 * resource deletion, so errors are swallowed.
 * @param {string} sha256
 * @param {{ pubkey: string, signEvent: Function }} activeUser
 */
export async function deleteCompanionLicense(sha256, activeUser) {
  try {
    const license = await findExistingLicense(sha256);
    if (license && license.pubkey === activeUser.pubkey) {
      await deleteEvent(license, activeUser);
    }
  } catch (err) {
    console.warn('Companion 1063 deletion skipped:', err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes.**

- [ ] **Step 5: Wire into `AMBResourceView.svelte`**

Imports + deriveds (top of script):

```js
  import WebxdcPlayer from '$lib/webxdc/WebxdcPlayer.svelte';
  import { useLicenseForHash } from '$lib/stores/image-license.svelte.js';
  import { findInteractiveEncoding, resourceAppKey, deleteCompanionLicense } from '$lib/helpers/educational/interactiveResource.js';

  const interactiveEncoding = $derived(findInteractiveEncoding(resource));
  const getInteractiveLicense = useLicenseForHash(() => interactiveEncoding?.sha256);
  const interactiveIconUrl = $derived(
    getInteractiveLicense()?.tags.find((t) => t[0] === 'image')?.[1] ?? ''
  );
```

Template — directly above the uploaded-files section (~line 894):

```svelte
  {#if interactiveEncoding}
    <div class="mb-4">
      <WebxdcPlayer
        url={interactiveEncoding.url}
        sha256={interactiveEncoding.sha256 ?? ''}
        name={resource.name}
        iconUrl={interactiveIconUrl}
        appKey={resourceAppKey(event)}
      />
    </div>
  {/if}
```

In the uploaded-files `{#each resource.encodings …}` loop, skip the preview for the package (the player replaces it) but keep the download row: guard the `<EncodingPreview …/>` render with `{#if file.mimeType !== 'application/x-webxdc'}`.

Delete flow (~line 170): after the existing `deleteEvent(event, activeUser)` succeeds, add:

```js
      if (interactiveEncoding?.sha256) {
        await deleteCompanionLicense(interactiveEncoding.sha256, activeUser);
      }
```

- [ ] **Step 6: Manual smoke** — `pnpm run dev`; open the resource published in Task 12 Step 5: badge on the card, launch card in the view, Launch runs the app (check the iframe loads on `<label>.iframe.diy`), state persists across reload (for an app that stores state), delete removes both events.

- [ ] **Step 7: Commit**

```bash
git add src/lib/helpers/educational/interactiveResource.js src/lib/helpers/educational/__tests__/interactiveResource.test.js src/lib/components/educational/AMBResourceView.svelte
git commit -m "feat(webxdc): sandboxed player in resource view + companion 1063 cleanup"
```

---

### Task 15: Full verification + docs

**Files:**
- Modify: `CLAUDE.md` (Event Kinds table note; new module mention)

**Steps:**

- [ ] **Step 1: Full test suite** — `pnpm test`. Expected: green (known-flaky inbox/DM files excepted per memory — re-run those in isolation if they fail collection).
- [ ] **Step 2: Types + lint** — `pnpm run check && pnpm run lint`. Fix anything introduced by this plan.
- [ ] **Step 3: Docs** — in `CLAUDE.md`: extend the kind-1063 row ("also NIP-DC webxdc discovery for interactive resources, `m application/x-webxdc`") and add a short "Interactive Resources (webxdc)" section: module `src/lib/webxdc/`, `SANDBOX_DOMAIN` env, variant `interactive`, spec pointer.
- [ ] **Step 4: End-to-end manual pass** of the full educator flow with a real `.h5p` file (export one from lumi.education or h5p.org samples): upload → wrap → preview → license → publish → discover card → launch → results persist → delete.
- [ ] **Step 5: Interop spot-check** — from Node (per memory: global WebSocket, zero deps), REQ `{kinds:[1063], "#m":["application/x-webxdc"], authors:[<your pk>]}` against the AMB + fallback relays and confirm the published discovery event is served (this is exactly Armada's picker query).
- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: interactive resources (webxdc) module and config"
```

---

## Out of scope (future plans)

- Phase 2: `community-sync.js` (kinds 9450/24450), chat `imeta` attachments, chat launch cards — spec Section 5.
- Phase 3: results/leaderboard panel — spec Section 6.
- E2E happy-path test (after Phase 1 stabilizes in dev).
- Self-hosted sandbox shim on `*.sandbox.edufeed.org` (config flip; only if iframe.diy disappoints).
