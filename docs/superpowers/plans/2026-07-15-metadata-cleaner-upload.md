# Metadata Cleaner Upload Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users inspect and clean file metadata (and compress PDFs) via the edufeed metadata-cleaner service before uploading to Blossom, as an optional review step in `LicensedFileInput` and `LicensedImageInput`.

**Architecture:** A server-side SvelteKit proxy (`/api/metaclean/[...path]`) forwards an allowlisted subset of the metacleaner HTTP API (the service sends no CORS headers; `METADATA_CLEANER_URL` stays server-side). A thin client helper wraps the proxy. A new shared `MetadataCleanerModal` opens as an interstitial in both upload components' pick pipelines — before hashing/license attestation — and resolves to either the original or the cleaned `File`.

**Tech Stack:** SvelteKit, Svelte 5 runes, JS + JSDoc, DaisyUI, Paraglide i18n, Vitest (node + jsdom).

**Spec:** `docs/superpowers/specs/2026-07-15-metadata-cleaner-upload-design.md` · **Issue:** https://git.edufeed.org/edufeed/edufeed-app/issues/47

## Global Constraints

- Svelte 5 runes only (`$state`, `$derived`, `$effect`, `$props`, `$bindable`); plain `let` for non-UI refs (subscriptions, promise resolvers).
- JavaScript with JSDoc annotations — no TypeScript files.
- All user-facing strings via Paraglide: add keys to BOTH `messages/en.json` and `messages/de.json`, prefix `metaclean_`, snake_case. Never place a literal `@` directly before a `{param}` placeholder in a message value (breaks svelte-check).
- Style with DaisyUI semantic classes only (`bg-base-100`, `text-error`, `btn`, `modal`…), no hardcoded colors.
- Env var `METADATA_CLEANER_URL` is server-side only; the browser sees only `metadataCleaner.enabled`.
- TDD: write the failing test first, watch it fail, implement, watch it pass, commit.
- Unit tests: `src/lib/__tests__/` with `/** @vitest-environment node */`. Component tests: `src/lib/components/__tests__/` with `/** @vitest-environment jsdom */`.
- Run targeted tests with `pnpm vitest run <path>`; full suite `pnpm test` (known-flaky inbox/DM files under the full run are pre-existing).
- Commit style: `feat(scope): …` / `test(scope): …`; lint-staged runs prettier automatically on commit.

---

### Task 1: Config exposure — `metadataCleaner.enabled`

**Files:**
- Modify: `src/routes/api/config/+server.js` (append after the `oer:` block, ~line 377)
- Modify: `src/lib/stores/config.svelte.js` (three spots: `defaultConfig` ~line 180, deep-merge ~line 327, getter ~line 427)
- Test: `src/lib/__tests__/api-config-metaclean.test.js` (create)

**Interfaces:**
- Produces: `runtimeConfig.metadataCleaner` → `{ enabled: boolean }`, consumed by Tasks 5–6.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/api-config-metaclean.test.js` (mirror of `api-config-oer.test.js`):

```js
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('GET /api/config — metadataCleaner.enabled', () => {
  beforeEach(() => vi.resetModules());

  it('metadataCleaner.enabled is true when METADATA_CLEANER_URL is set', async () => {
    vi.doMock('$env/dynamic/private', () => ({
      env: { METADATA_CLEANER_URL: 'https://cleaner.example' }
    }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.metadataCleaner).toEqual({ enabled: true });
  });

  it('metadataCleaner.enabled is false when METADATA_CLEANER_URL is unset', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: {} }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.metadataCleaner).toEqual({ enabled: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/api-config-metaclean.test.js`
Expected: FAIL — `body.metadataCleaner` is `undefined`.

- [ ] **Step 3: Implement**

In `src/routes/api/config/+server.js`, after the `oer: { enabled: Boolean(env.OER_PROXY_URL) }` block (keep the trailing comma correct):

```js
    // Metadata cleaner (inspect/strip file metadata, compress PDFs before
    // upload). Only exposes whether it's enabled — the URL stays server-side.
    metadataCleaner: {
      enabled: Boolean(env.METADATA_CLEANER_URL)
    }
```

In `src/lib/stores/config.svelte.js`:

1. `defaultConfig` (after the `oer` entry):

```js
  // Metadata cleaner availability (service URL stays server-side)
  metadataCleaner: {
    enabled: false
  }
```

2. Deep-merge in `initializeConfig` (after the `oer` merge):

```js
    metadataCleaner: {
      ...defaultConfig.metadataCleaner,
      ...runtimeConfig.metadataCleaner
    },
```

3. Getter on the exported `runtimeConfig` object (after `get oer()`):

```js
  get metadataCleaner() {
    return config.metadataCleaner;
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/__tests__/api-config-metaclean.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/config/+server.js src/lib/stores/config.svelte.js src/lib/__tests__/api-config-metaclean.test.js
git commit -m "feat(config): expose metadataCleaner.enabled from METADATA_CLEANER_URL (#47)"
```

---

### Task 2: Server proxy `/api/metaclean/[...path]`

**Files:**
- Create: `src/routes/api/metaclean/[...path]/+server.js`
- Test: `src/lib/__tests__/api-metaclean-route.test.js` (create)

**Interfaces:**
- Consumes: `METADATA_CLEANER_URL` env (Task 1's env var, read directly via `$env/dynamic/private`).
- Produces: HTTP routes used by Task 3's helper:
  - `POST /api/metaclean/files` (multipart, field `file`)
  - `GET /api/metaclean/files/{id}/ops/strip`
  - `POST /api/metaclean/files/{id}/apply` (JSON)
  - `GET /api/metaclean/files/{id}/download`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/api-metaclean-route.test.js`:

```js
// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
  env: { METADATA_CLEANER_URL: 'https://cleaner.example' }
}));

const { GET, POST } = await import('../../routes/api/metaclean/[...path]/+server.js');

/** Build a RequestEvent-ish object for the catch-all route. */
function ev(path, { method = 'GET', body = null, contentType = null } = {}) {
  const headers = new Headers();
  if (contentType) headers.set('content-type', contentType);
  return {
    params: { path },
    request: new Request(`http://localhost/api/metaclean/${path}`, {
      method,
      headers,
      body
    }),
    fetch: fetchMock
  };
}

let fetchMock;

function upstreamResponse(body = '{"ok":true}', init = {}) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  });
}

beforeEach(() => {
  fetchMock = vi.fn(async () => upstreamResponse());
});

describe('/api/metaclean allowlist', () => {
  it('POST files forwards to upstream /api/files with the request body', async () => {
    const res = await POST(ev('files', { method: 'POST', body: 'FILEBYTES', contentType: 'multipart/form-data; boundary=x' }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://cleaner.example/api/files');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toContain('multipart/form-data');
  });

  it('GET ops/strip forwards with validated session id', async () => {
    const res = await GET(ev('files/abc-123/ops/strip'));
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe('https://cleaner.example/api/files/abc-123/ops/strip');
  });

  it('POST apply forwards JSON', async () => {
    const res = await POST(
      ev('files/abc-123/apply', { method: 'POST', body: '{"ops":[]}', contentType: 'application/json' })
    );
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe('https://cleaner.example/api/files/abc-123/apply');
  });

  it('GET download passes through content-disposition', async () => {
    fetchMock.mockResolvedValueOnce(
      upstreamResponse('bytes', {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="doc-clean.pdf"'
        }
      })
    );
    const res = await GET(ev('files/abc-123/download'));
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="doc-clean.pdf"');
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });

  it('rejects unknown paths with 404 and never calls upstream', async () => {
    for (const path of ['oer-ops', 'files/abc/sidecar', 'files/../evil/download', 'files']) {
      const res = await GET(ev(path));
      expect(res.status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid session ids with 404', async () => {
    const res = await GET(ev('files/ab%2Fc/download'));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps upstream network failure to 502', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await GET(ev('files/abc/download'));
    expect(res.status).toBe(502);
  });

  it('passes through upstream error status and body', async () => {
    fetchMock.mockResolvedValueOnce(
      upstreamResponse('{"error":"session expired"}', { status: 404 })
    );
    const res = await GET(ev('files/abc/download'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'session expired' });
  });
});

describe('/api/metaclean without METADATA_CLEANER_URL', () => {
  it('returns 503 when unconfigured', async () => {
    vi.resetModules();
    vi.doMock('$env/dynamic/private', () => ({ env: {} }));
    const mod = await import('../../routes/api/metaclean/[...path]/+server.js');
    const res = await mod.GET(ev('files/abc/download'));
    expect(res.status).toBe(503);
  });
});
```

Note: `GET(ev('files'))` (last entry of the unknown-paths loop) is 404 because plain `files` is only allowlisted for POST.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/api-metaclean-route.test.js`
Expected: FAIL — cannot resolve `../../routes/api/metaclean/[...path]/+server.js`.

- [ ] **Step 3: Implement the route**

Create `src/routes/api/metaclean/[...path]/+server.js`:

```js
/**
 * Server-side proxy to the metadata-cleaner service (metacleaner).
 *
 * The service sends no CORS headers, so the browser cannot call it directly;
 * this route forwards a strict allowlist of its JSON/file API and keeps
 * METADATA_CLEANER_URL server-side. Mirrors /api/oer's 503-when-unconfigured
 * contract. Anything not on the allowlist is a 404 — notably oer-ops and
 * sidecar, which are deliberately not exposed (out of scope, see issue #47).
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const SESSION_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Map an app-relative path to the upstream metacleaner path, or null when the
 * path/method combination is not allowlisted.
 * @param {string} path - catch-all segment, e.g. "files/abc/ops/strip"
 * @param {string} method
 * @returns {string | null}
 */
function resolveUpstreamPath(path, method) {
  if (method === 'POST' && path === 'files') return '/api/files';
  const parts = path.split('/');
  if (parts[0] !== 'files' || parts.length < 3 || !SESSION_ID.test(parts[1])) return null;
  const rest = parts.slice(2).join('/');
  if (method === 'GET' && rest === 'ops/strip') return `/api/files/${parts[1]}/ops/strip`;
  if (method === 'POST' && rest === 'apply') return `/api/files/${parts[1]}/apply`;
  if (method === 'GET' && rest === 'download') return `/api/files/${parts[1]}/download`;
  return null;
}

/** @param {import('@sveltejs/kit').RequestEvent} event */
async function proxy(event) {
  const baseUrl = env.METADATA_CLEANER_URL;
  if (!baseUrl) {
    return json({ error: 'Metadata cleaner not configured' }, { status: 503 });
  }

  const method = event.request.method;
  const upstreamPath = resolveUpstreamPath(event.params.path ?? '', method);
  if (!upstreamPath) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  /** @type {RequestInit} */
  const init = { method, headers: {} };
  if (method === 'POST') {
    const contentType = event.request.headers.get('content-type');
    if (contentType) init.headers = { 'content-type': contentType };
    // Buffer the body: uploads are bounded by the Blossom max-file-size the
    // pickers already enforce, and buffering avoids undici duplex quirks.
    init.body = await event.request.arrayBuffer();
  }

  let upstream;
  try {
    upstream = await event.fetch(baseUrl.replace(/\/+$/, '') + upstreamPath, init);
  } catch (err) {
    console.error('[/api/metaclean] upstream request failed:', err);
    return json({ error: 'Metadata cleaner unreachable' }, { status: 502 });
  }

  const headers = new Headers();
  for (const name of ['content-type', 'content-disposition']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

export const GET = proxy;
export const POST = proxy;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/__tests__/api-metaclean-route.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add "src/routes/api/metaclean/[...path]/+server.js" src/lib/__tests__/api-metaclean-route.test.js
git commit -m "feat(api): add /api/metaclean proxy to the metadata-cleaner service (#47)"
```

---

### Task 3: Client helper `src/lib/helpers/metaclean.js`

**Files:**
- Create: `src/lib/helpers/metaclean.js`
- Test: `src/lib/__tests__/metaclean-helper.test.js` (create)

**Interfaces:**
- Consumes: Task 2's proxy routes (relative URLs).
- Produces (used by Task 4's modal and Tasks 5–6):
  - `isSupportedFile(file: File): boolean`
  - `isPdfFile(file: File): boolean`
  - `inspectFile(file: File, fetchImpl?): Promise<{ sessionId: string, filename: string, fields: MetaField[] }>`
  - `getStripOps(sessionId: string, fetchImpl?): Promise<{ ops: Op[] }>`
  - `applyOps(sessionId: string, { ops: Op[], compress?: 'off'|'balanced'|'strong' }, fetchImpl?): Promise<ApplyResult>`
  - `downloadCleaned(sessionId: string, filename: string, type: string, fetchImpl?): Promise<File>`
  - `groupFieldsByStore(fields: MetaField[]): Array<{ store: string, fields: MetaField[] }>`
  - `MetaField` = `{ id, store, key, label, value, sensitive, ... }` (service shape, passed through)

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/metaclean-helper.test.js`:

```js
// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  isSupportedFile,
  isPdfFile,
  inspectFile,
  getStripOps,
  applyOps,
  downloadCleaned,
  groupFieldsByStore
} from '../helpers/metaclean.js';

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });

describe('isSupportedFile / isPdfFile', () => {
  it('accepts pdf and supported image MIME types', () => {
    for (const type of ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff', 'image/webp']) {
      expect(isSupportedFile(new File(['x'], 'f', { type }))).toBe(true);
    }
  });

  it('rejects unsupported types', () => {
    for (const type of ['image/gif', 'image/svg+xml', 'video/mp4', 'application/zip']) {
      expect(isSupportedFile(new File(['x'], 'f', { type }))).toBe(false);
    }
  });

  it('falls back to the extension when MIME type is empty', () => {
    expect(isSupportedFile(new File(['x'], 'doc.PDF', { type: '' }))).toBe(true);
    expect(isSupportedFile(new File(['x'], 'pic.jpeg', { type: '' }))).toBe(true);
    expect(isSupportedFile(new File(['x'], 'notes.txt', { type: '' }))).toBe(false);
  });

  it('isPdfFile identifies PDFs by MIME or extension', () => {
    expect(isPdfFile(new File(['x'], 'a', { type: 'application/pdf' }))).toBe(true);
    expect(isPdfFile(new File(['x'], 'a.pdf', { type: '' }))).toBe(true);
    expect(isPdfFile(new File(['x'], 'a.png', { type: 'image/png' }))).toBe(false);
  });
});

describe('inspectFile', () => {
  it('POSTs multipart to /api/metaclean/files and returns the session', async () => {
    const payload = { sessionId: 's1', filename: 'doc.pdf', fields: [] };
    const fetchMock = vi.fn(async () => jsonResponse(payload));
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    const result = await inspectFile(file, fetchMock);
    expect(result).toEqual(payload);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/metaclean/files');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get('file')).toBe(file);
  });

  it('throws the upstream error message on failure', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'too large' }, 413));
    await expect(inspectFile(new File(['x'], 'a.pdf'), fetchMock)).rejects.toThrow('too large');
  });
});

describe('getStripOps / applyOps', () => {
  it('getStripOps GETs the strip ops', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ops: [{ type: 'delete', fieldId: 'x' }] }));
    const result = await getStripOps('s1', fetchMock);
    expect(result.ops).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/metaclean/files/s1/ops/strip');
  });

  it('applyOps POSTs ops with flatten and preserveDates true', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ before: [], after: [], leaks: [] }));
    await applyOps('s1', { ops: [{ type: 'delete', fieldId: 'x' }], compress: 'balanced' }, fetchMock);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/metaclean/files/s1/apply');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      ops: [{ type: 'delete', fieldId: 'x' }],
      flatten: true,
      preserveDates: true,
      compress: 'balanced'
    });
  });

  it('applyOps omits compress when off or absent', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ before: [], after: [], leaks: [] }));
    await applyOps('s1', { ops: [], compress: 'off' }, fetchMock);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('compress');
  });
});

describe('downloadCleaned', () => {
  it('returns a File with the given name and type', async () => {
    const fetchMock = vi.fn(
      async () => new Response(new Blob(['CLEANED']), { status: 200 })
    );
    const file = await downloadCleaned('s1', 'doc.pdf', 'application/pdf', fetchMock);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/metaclean/files/s1/download');
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('doc.pdf');
    expect(file.type).toBe('application/pdf');
    expect(await file.text()).toBe('CLEANED');
  });
});

describe('groupFieldsByStore', () => {
  it('groups preserving first-seen store order', () => {
    const fields = [
      { id: 'a', store: 'DocInfo' },
      { id: 'b', store: 'XMP' },
      { id: 'c', store: 'DocInfo' }
    ];
    expect(groupFieldsByStore(fields)).toEqual([
      { store: 'DocInfo', fields: [fields[0], fields[2]] },
      { store: 'XMP', fields: [fields[1]] }
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/metaclean-helper.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/helpers/metaclean.js`:

```js
/**
 * Browser-side wrappers over the /api/metaclean proxy (metadata-cleaner
 * service). `fetch` is injected (defaults to global) so these unit-test
 * without a running server — same pattern as helpers/oer/searchOer.js.
 *
 * @typedef {Object} MetaField
 * @property {string} id - field id used in ops, e.g. "pdf.docinfo./Producer"
 * @property {string} store - "DocInfo" | "XMP" | "EXIF" | "IPTC" | "PNG" | "Other"
 * @property {string} key
 * @property {string} label
 * @property {string} value
 * @property {boolean} sensitive
 *
 * @typedef {{ type: 'delete', fieldId: string } | { type: 'set', fieldId: string, value: string } | { type: 'add', store: string, key: string, value: string }} Op
 *
 * @typedef {Object} ApplyResult
 * @property {MetaField[]} before
 * @property {MetaField[]} after
 * @property {string[]} leaks
 * @property {string[]} [warnings]
 * @property {number} sizeBefore
 * @property {number} sizeAfter
 * @property {{ processed: number, skipped: number, bytesBefore: number, bytesAfter: number }} [compression]
 */

const SUPPORTED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp'
]);
const SUPPORTED_EXT = /\.(pdf|jpe?g|png|tiff?|webp)$/i;
const PDF_EXT = /\.pdf$/i;

/**
 * Whether the metadata cleaner supports this file type.
 * @param {File} file
 */
export function isSupportedFile(file) {
  if (file.type) return SUPPORTED_MIME.has(file.type);
  return SUPPORTED_EXT.test(file.name);
}

/**
 * Whether this file is a PDF (the only type supporting compression).
 * @param {File} file
 */
export function isPdfFile(file) {
  if (file.type) return file.type === 'application/pdf';
  return PDF_EXT.test(file.name);
}

/**
 * Extract the upstream error message from a failed proxy response.
 * @param {Response} res
 * @returns {Promise<Error>}
 */
async function toError(res) {
  try {
    const body = await res.json();
    if (body?.error) return new Error(body.error);
  } catch {
    // non-JSON error body — fall through to the generic message
  }
  return new Error(`Metadata cleaner request failed: HTTP ${res.status}`);
}

/**
 * Upload a file for inspection; creates a server-side session.
 * @param {File} file
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ sessionId: string, filename: string, fields: MetaField[] }>}
 */
export async function inspectFile(file, fetchImpl = fetch) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetchImpl('/api/metaclean/files', { method: 'POST', body: form });
  if (!res.ok) throw await toError(res);
  return res.json();
}

/**
 * Fetch the strip-provenance operations for the session's file.
 * @param {string} sessionId
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ ops: Op[] }>}
 */
export async function getStripOps(sessionId, fetchImpl = fetch) {
  const res = await fetchImpl(`/api/metaclean/files/${sessionId}/ops/strip`);
  if (!res.ok) throw await toError(res);
  return res.json();
}

/**
 * Apply operations (and optional PDF compression) to the session's file.
 * flatten + preserveDates are always sent true, matching the service's own UI.
 * @param {string} sessionId
 * @param {{ ops: Op[], compress?: 'off' | 'balanced' | 'strong' }} params
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<ApplyResult>}
 */
export async function applyOps(sessionId, { ops, compress }, fetchImpl = fetch) {
  /** @type {Record<string, unknown>} */
  const body = { ops, flatten: true, preserveDates: true };
  if (compress && compress !== 'off') body.compress = compress;
  const res = await fetchImpl(`/api/metaclean/files/${sessionId}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw await toError(res);
  return res.json();
}

/**
 * Download the cleaned copy as a File carrying the original name and type,
 * so it can replace the pending upload transparently.
 * @param {string} sessionId
 * @param {string} filename
 * @param {string} type
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<File>}
 */
export async function downloadCleaned(sessionId, filename, type, fetchImpl = fetch) {
  const res = await fetchImpl(`/api/metaclean/files/${sessionId}/download`);
  if (!res.ok) throw await toError(res);
  const blob = await res.blob();
  return new File([blob], filename, { type });
}

/**
 * Group fields by store, preserving first-seen store order.
 * @param {MetaField[]} fields
 * @returns {Array<{ store: string, fields: MetaField[] }>}
 */
export function groupFieldsByStore(fields) {
  /** @type {Map<string, MetaField[]>} */
  const byStore = new Map();
  for (const field of fields) {
    const bucket = byStore.get(field.store);
    if (bucket) bucket.push(field);
    else byStore.set(field.store, [field]);
  }
  return [...byStore.entries()].map(([store, storeFields]) => ({ store, fields: storeFields }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/__tests__/metaclean-helper.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/helpers/metaclean.js src/lib/__tests__/metaclean-helper.test.js
git commit -m "feat(shared): add metaclean client helper over /api/metaclean (#47)"
```

---

### Task 4: `MetadataCleanerModal` component + i18n

**Files:**
- Create: `src/lib/components/shared/MetadataCleanerModal.svelte`
- Modify: `messages/en.json`, `messages/de.json` (add `metaclean_*` keys)
- Test: `src/lib/components/__tests__/MetadataCleanerModal.test.js` (create)

**Interfaces:**
- Consumes: Task 3's helper (`inspectFile`, `getStripOps`, `applyOps`, `downloadCleaned`, `isPdfFile`, `groupFieldsByStore`).
- Produces (used by Tasks 5–6): component with props
  `{ open: boolean ($bindable), file: File | null, ondone: (file: File) => void }`.
  `ondone` always fires exactly once per open cycle — with the cleaned `File` after "Use cleaned file", or with the original `file` on "Continue with original" / close. The modal closes itself (`open = false`) before calling `ondone`.

- [ ] **Step 1: Add the Paraglide messages**

In `messages/en.json` add (keep alphabetical-ish grouping near other keys is not required; append in one block):

```json
{
  "metaclean_title": "Check metadata",
  "metaclean_subtitle": "This is the metadata your file carries. You can remove tool provenance before uploading.",
  "metaclean_inspecting": "Reading metadata…",
  "metaclean_no_fields": "No metadata found in this file.",
  "metaclean_sensitive_badge": "sensitive",
  "metaclean_strip_toggle": "Remove tool provenance",
  "metaclean_strip_description": "Removes fields like Creator, Producer and tool keywords from all metadata stores.",
  "metaclean_strip_nothing": "No tool provenance found — nothing to remove.",
  "metaclean_strip_list_title": "Fields that will be removed",
  "metaclean_compress_label": "Compress embedded images (PDF, lossy)",
  "metaclean_compress_off": "Off",
  "metaclean_compress_balanced": "Balanced",
  "metaclean_compress_strong": "Strong",
  "metaclean_apply": "Clean file",
  "metaclean_applying": "Cleaning…",
  "metaclean_result_title": "Verified result",
  "metaclean_fields_before_after": "Metadata fields: {before} before, {after} after",
  "metaclean_size_before_after": "File size: {before} to {after}",
  "metaclean_leaks_clean": "Leak scan: no removed values found in the output.",
  "metaclean_leaks_found": "Warning: some removed values are still detectable in the file.",
  "metaclean_use_cleaned": "Use cleaned file",
  "metaclean_keep_original": "Continue with original",
  "metaclean_error_title": "Metadata check failed",
  "metaclean_retry": "Retry"
}
```

In `messages/de.json`:

```json
{
  "metaclean_title": "Metadaten prüfen",
  "metaclean_subtitle": "Diese Metadaten stecken in deiner Datei. Du kannst Werkzeug-Spuren vor dem Hochladen entfernen.",
  "metaclean_inspecting": "Metadaten werden gelesen…",
  "metaclean_no_fields": "Keine Metadaten in dieser Datei gefunden.",
  "metaclean_sensitive_badge": "sensibel",
  "metaclean_strip_toggle": "Werkzeug-Spuren entfernen",
  "metaclean_strip_description": "Entfernt Felder wie Creator, Producer und Werkzeug-Schlagwörter aus allen Metadaten-Speichern.",
  "metaclean_strip_nothing": "Keine Werkzeug-Spuren gefunden — nichts zu entfernen.",
  "metaclean_strip_list_title": "Felder, die entfernt werden",
  "metaclean_compress_label": "Eingebettete Bilder komprimieren (PDF, verlustbehaftet)",
  "metaclean_compress_off": "Aus",
  "metaclean_compress_balanced": "Ausgewogen",
  "metaclean_compress_strong": "Stark",
  "metaclean_apply": "Datei bereinigen",
  "metaclean_applying": "Wird bereinigt…",
  "metaclean_result_title": "Verifiziertes Ergebnis",
  "metaclean_fields_before_after": "Metadaten-Felder: {before} vorher, {after} nachher",
  "metaclean_size_before_after": "Dateigröße: {before} zu {after}",
  "metaclean_leaks_clean": "Leak-Scan: keine entfernten Werte in der Ausgabe gefunden.",
  "metaclean_leaks_found": "Warnung: Einige entfernte Werte sind in der Datei noch auffindbar.",
  "metaclean_use_cleaned": "Bereinigte Datei verwenden",
  "metaclean_keep_original": "Mit Original fortfahren",
  "metaclean_error_title": "Metadaten-Prüfung fehlgeschlagen",
  "metaclean_retry": "Erneut versuchen"
}
```

(Add these keys into the existing JSON objects — do not create nested objects. Do not place `@` before `{before}`/`{after}`.)

- [ ] **Step 2: Write the failing component test**

Create `src/lib/components/__tests__/MetadataCleanerModal.test.js`:

```js
// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  inspectFile: vi.fn(),
  getStripOps: vi.fn(),
  applyOps: vi.fn(),
  downloadCleaned: vi.fn()
}));

vi.mock('$lib/helpers/metaclean.js', async () => {
  const actual = await vi.importActual('$lib/helpers/metaclean.js');
  return {
    ...actual,
    inspectFile: mocks.inspectFile,
    getStripOps: mocks.getStripOps,
    applyOps: mocks.applyOps,
    downloadCleaned: mocks.downloadCleaned
  };
});

vi.mock('$lib/paraglide/messages', () => ({
  metaclean_title: () => 'Check metadata',
  metaclean_subtitle: () => 'Subtitle',
  metaclean_inspecting: () => 'Reading metadata…',
  metaclean_no_fields: () => 'No metadata found in this file.',
  metaclean_sensitive_badge: () => 'sensitive',
  metaclean_strip_toggle: () => 'Remove tool provenance',
  metaclean_strip_description: () => 'Strip description',
  metaclean_strip_nothing: () => 'Nothing to remove',
  metaclean_strip_list_title: () => 'Fields that will be removed',
  metaclean_compress_label: () => 'Compress embedded images (PDF, lossy)',
  metaclean_compress_off: () => 'Off',
  metaclean_compress_balanced: () => 'Balanced',
  metaclean_compress_strong: () => 'Strong',
  metaclean_apply: () => 'Clean file',
  metaclean_applying: () => 'Cleaning…',
  metaclean_result_title: () => 'Verified result',
  metaclean_fields_before_after: ({ before, after }) => `Fields: ${before} -> ${after}`,
  metaclean_size_before_after: ({ before, after }) => `Size: ${before} -> ${after}`,
  metaclean_leaks_clean: () => 'Leak scan: clean',
  metaclean_leaks_found: () => 'Leaks found',
  metaclean_use_cleaned: () => 'Use cleaned file',
  metaclean_keep_original: () => 'Continue with original',
  metaclean_error_title: () => 'Metadata check failed',
  metaclean_retry: () => 'Retry'
}));

import MetadataCleanerModal from '../shared/MetadataCleanerModal.svelte';

const pdfFile = () => new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' });
const pngFile = () => new File(['png'], 'pic.png', { type: 'image/png' });

const FIELDS = [
  { id: 'pdf.docinfo./Producer', store: 'DocInfo', key: '/Producer', label: '/Producer', value: 'Canva', sensitive: true },
  { id: 'xmp.dc:title', store: 'XMP', key: 'dc:title', label: 'dc:title', value: 'Doc', sensitive: false }
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inspectFile.mockResolvedValue({ sessionId: 's1', filename: 'doc.pdf', fields: FIELDS });
  mocks.getStripOps.mockResolvedValue({ ops: [{ type: 'delete', fieldId: 'pdf.docinfo./Producer' }] });
  mocks.applyOps.mockResolvedValue({
    before: FIELDS,
    after: [FIELDS[1]],
    leaks: [],
    sizeBefore: 1000,
    sizeAfter: 800
  });
  mocks.downloadCleaned.mockResolvedValue(new File(['clean'], 'doc.pdf', { type: 'application/pdf' }));
});

describe('MetadataCleanerModal', () => {
  it('renders nothing when closed', () => {
    const { queryByText } = render(MetadataCleanerModal, {
      props: { open: false, file: pdfFile(), ondone: vi.fn() }
    });
    expect(queryByText('Check metadata')).toBeNull();
  });

  it('inspects on open and shows fields grouped by store with sensitive badge', async () => {
    const { getByText, getAllByText } = render(MetadataCleanerModal, {
      props: { open: true, file: pdfFile(), ondone: vi.fn() }
    });
    await waitFor(() => expect(getByText('Canva')).toBeTruthy());
    expect(getByText('DocInfo')).toBeTruthy();
    expect(getByText('XMP')).toBeTruthy();
    expect(getAllByText('sensitive')).toHaveLength(1);
    expect(mocks.inspectFile).toHaveBeenCalledOnce();
    expect(mocks.getStripOps).toHaveBeenCalledWith('s1');
  });

  it('shows the compression picker for PDFs only', async () => {
    const pdf = render(MetadataCleanerModal, {
      props: { open: true, file: pdfFile(), ondone: vi.fn() }
    });
    await waitFor(() =>
      expect(pdf.getByText('Compress embedded images (PDF, lossy)')).toBeTruthy()
    );
    pdf.unmount();

    const png = render(MetadataCleanerModal, {
      props: { open: true, file: pngFile(), ondone: vi.fn() }
    });
    await waitFor(() => expect(png.getByText('Canva')).toBeTruthy());
    expect(png.queryByText('Compress embedded images (PDF, lossy)')).toBeNull();
  });

  it('applies strip ops, shows result, and returns the cleaned file', async () => {
    const ondone = vi.fn();
    const { getByText, getByTestId } = render(MetadataCleanerModal, {
      props: { open: true, file: pdfFile(), ondone }
    });
    await waitFor(() => expect(getByText('Canva')).toBeTruthy());

    await fireEvent.click(getByTestId('metaclean-apply'));
    await waitFor(() => expect(getByText('Verified result')).toBeTruthy());
    expect(mocks.applyOps).toHaveBeenCalledWith('s1', {
      ops: [{ type: 'delete', fieldId: 'pdf.docinfo./Producer' }],
      compress: 'off'
    });
    expect(getByText('Leak scan: clean')).toBeTruthy();

    await fireEvent.click(getByText('Use cleaned file'));
    await waitFor(() => expect(ondone).toHaveBeenCalledOnce());
    expect(ondone.mock.calls[0][0].name).toBe('doc.pdf');
    expect(await ondone.mock.calls[0][0].text()).toBe('clean');
  });

  it('returns the original file on "Continue with original"', async () => {
    const ondone = vi.fn();
    const file = pdfFile();
    const { getByText } = render(MetadataCleanerModal, {
      props: { open: true, file, ondone }
    });
    await waitFor(() => expect(getByText('Canva')).toBeTruthy());
    await fireEvent.click(getByText('Continue with original'));
    expect(ondone).toHaveBeenCalledOnce();
    expect(ondone.mock.calls[0][0]).toBe(file);
    expect(mocks.applyOps).not.toHaveBeenCalled();
  });

  it('shows an error state with retry and keep-original when inspect fails', async () => {
    mocks.inspectFile.mockRejectedValueOnce(new Error('service down'));
    const ondone = vi.fn();
    const file = pdfFile();
    const { getByText } = render(MetadataCleanerModal, {
      props: { open: true, file, ondone }
    });
    await waitFor(() => expect(getByText('Metadata check failed')).toBeTruthy());
    expect(getByText('service down')).toBeTruthy();
    await fireEvent.click(getByText('Continue with original'));
    expect(ondone).toHaveBeenCalledWith(file);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/components/__tests__/MetadataCleanerModal.test.js`
Expected: FAIL — component module not found.

- [ ] **Step 4: Implement the component**

Create `src/lib/components/shared/MetadataCleanerModal.svelte`:

```svelte
<!--
  MetadataCleanerModal
  Optional pre-upload review step backed by the metadata-cleaner service
  (via /api/metaclean). Shows all metadata the file carries, lets the user
  strip tool provenance and (PDF only) recompress embedded images, then
  resolves with either the cleaned or the original File via ondone().
  ondone fires exactly once per open cycle.
-->

<script>
  import { topLayerModal } from '$lib/actions/topLayerModal.js';
  import * as m from '$lib/paraglide/messages';
  import {
    inspectFile,
    getStripOps,
    applyOps,
    downloadCleaned,
    isPdfFile,
    groupFieldsByStore
  } from '$lib/helpers/metaclean.js';

  /** @type {{ open?: boolean, file: File | null, ondone?: (file: File) => void }} */
  let { open = $bindable(false), file = null, ondone = () => {} } = $props();

  /** @type {'inspecting' | 'review' | 'applying' | 'done' | 'error'} */
  let phase = $state('inspecting');
  let errorMessage = $state('');
  let sessionId = $state('');
  /** @type {import('$lib/helpers/metaclean.js').MetaField[]} */
  let fields = $state.raw([]);
  /** @type {import('$lib/helpers/metaclean.js').Op[]} */
  let stripOps = $state.raw([]);
  let stripEnabled = $state(true);
  /** @type {'off' | 'balanced' | 'strong'} */
  let compress = $state('off');
  /** @type {import('$lib/helpers/metaclean.js').ApplyResult | null} */
  let applyResult = $state.raw(null);

  // Guards double-fire of ondone (e.g. Escape after a button click).
  let doneFired = false;

  const isPdf = $derived(file ? isPdfFile(file) : false);
  const groupedFields = $derived(groupFieldsByStore(fields));
  const stripFieldLabels = $derived(
    stripOps
      .map((op) => (op.type === 'delete' ? op.fieldId : null))
      .filter((id) => id !== null)
  );
  const canApply = $derived(
    (stripEnabled && stripOps.length > 0) || (isPdf && compress !== 'off')
  );

  // Inspect whenever the modal opens for a file. `open` and `file` are read
  // first so the effect re-runs on every open cycle.
  $effect(() => {
    if (!open || !file) return;
    doneFired = false;
    runInspect(file);
  });

  /** @param {File} target */
  async function runInspect(target) {
    phase = 'inspecting';
    errorMessage = '';
    applyResult = null;
    stripEnabled = true;
    compress = 'off';
    try {
      const inspected = await inspectFile(target);
      sessionId = inspected.sessionId;
      fields = inspected.fields ?? [];
      const strip = await getStripOps(inspected.sessionId);
      stripOps = strip.ops ?? [];
      phase = 'review';
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
      phase = 'error';
    }
  }

  async function handleApply() {
    if (!canApply) return;
    phase = 'applying';
    errorMessage = '';
    try {
      applyResult = await applyOps(sessionId, {
        ops: stripEnabled ? stripOps : [],
        compress
      });
      phase = 'done';
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
      phase = 'error';
    }
  }

  /** @param {File} result */
  function finish(result) {
    if (doneFired) return;
    doneFired = true;
    open = false;
    ondone(result);
  }

  function handleKeepOriginal() {
    if (file) finish(file);
  }

  async function handleUseCleaned() {
    if (!file) return;
    try {
      const cleaned = await downloadCleaned(sessionId, file.name, file.type);
      finish(cleaned);
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
      phase = 'error';
    }
  }

  function handleRetry() {
    if (file) runInspect(file);
  }

  /** @param {number} bytes */
  function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
</script>

{#if open}
  <dialog class="modal-open modal" use:topLayerModal={handleKeepOriginal}>
    <div class="modal-box max-w-2xl">
      <h3 class="text-lg font-semibold">{m.metaclean_title()}</h3>

      {#if phase === 'inspecting'}
        <div class="flex items-center gap-3 py-8">
          <span class="loading loading-spinner text-primary"></span>
          <span>{m.metaclean_inspecting()}</span>
        </div>
      {:else if phase === 'error'}
        <div class="mt-4 alert alert-error">
          <div>
            <p class="font-medium">{m.metaclean_error_title()}</p>
            <p class="text-sm">{errorMessage}</p>
          </div>
        </div>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" onclick={handleRetry}>
            {m.metaclean_retry()}
          </button>
          <button type="button" class="btn btn-primary" onclick={handleKeepOriginal}>
            {m.metaclean_keep_original()}
          </button>
        </div>
      {:else if phase === 'review' || phase === 'applying'}
        <p class="mt-1 text-sm text-base-content/70">{m.metaclean_subtitle()}</p>

        {#if fields.length === 0}
          <p class="py-6 text-sm text-base-content/70">{m.metaclean_no_fields()}</p>
        {:else}
          <div class="mt-4 max-h-64 space-y-3 overflow-y-auto rounded-lg bg-base-200 p-3">
            {#each groupedFields as group (group.store)}
              <div>
                <div class="text-xs font-semibold tracking-wide text-base-content/60 uppercase">
                  {group.store}
                </div>
                <table class="table-xs table">
                  <tbody>
                    {#each group.fields as field (field.id)}
                      <tr>
                        <td class="w-1/3 font-mono text-xs whitespace-nowrap">
                          {field.label}
                          {#if field.sensitive}
                            <span class="badge ml-1 badge-xs badge-warning">
                              {m.metaclean_sensitive_badge()}
                            </span>
                          {/if}
                        </td>
                        <td class="font-mono text-xs break-all">{field.value}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/each}
          </div>
        {/if}

        <div class="mt-4 space-y-3">
          <label class="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              class="toggle mt-0.5 toggle-primary"
              bind:checked={stripEnabled}
              disabled={stripOps.length === 0 || phase === 'applying'}
              data-testid="metaclean-strip-toggle"
            />
            <span>
              <span class="font-medium">{m.metaclean_strip_toggle()}</span>
              <span class="block text-xs text-base-content/60">
                {stripOps.length === 0 ? m.metaclean_strip_nothing() : m.metaclean_strip_description()}
              </span>
            </span>
          </label>

          {#if stripEnabled && stripFieldLabels.length > 0}
            <div class="rounded-lg bg-base-200 p-2 text-xs">
              <div class="mb-1 font-medium">{m.metaclean_strip_list_title()}</div>
              <ul class="list-inside list-disc font-mono">
                {#each stripFieldLabels as fieldId (fieldId)}
                  <li>{fieldId}</li>
                {/each}
              </ul>
            </div>
          {/if}

          {#if isPdf}
            <label class="flex items-center gap-3">
              <span class="text-sm font-medium">{m.metaclean_compress_label()}</span>
              <select
                class="select-bordered select select-sm"
                bind:value={compress}
                disabled={phase === 'applying'}
                data-testid="metaclean-compress"
              >
                <option value="off">{m.metaclean_compress_off()}</option>
                <option value="balanced">{m.metaclean_compress_balanced()}</option>
                <option value="strong">{m.metaclean_compress_strong()}</option>
              </select>
            </label>
          {/if}
        </div>

        <div class="modal-action">
          <button
            type="button"
            class="btn btn-ghost"
            onclick={handleKeepOriginal}
            disabled={phase === 'applying'}
          >
            {m.metaclean_keep_original()}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            onclick={handleApply}
            disabled={!canApply || phase === 'applying'}
            data-testid="metaclean-apply"
          >
            {#if phase === 'applying'}
              <span class="loading loading-sm loading-spinner"></span>
              {m.metaclean_applying()}
            {:else}
              {m.metaclean_apply()}
            {/if}
          </button>
        </div>
      {:else if phase === 'done' && applyResult}
        <div class="mt-4 space-y-2">
          <h4 class="font-medium">{m.metaclean_result_title()}</h4>
          <p class="text-sm">
            {m.metaclean_fields_before_after({
              before: String(applyResult.before?.length ?? 0),
              after: String(applyResult.after?.length ?? 0)
            })}
          </p>
          <p class="text-sm">
            {m.metaclean_size_before_after({
              before: formatFileSize(applyResult.sizeBefore),
              after: formatFileSize(applyResult.sizeAfter)
            })}
          </p>
          {#if applyResult.leaks && applyResult.leaks.length > 0}
            <div class="alert py-2 alert-warning">
              <span class="text-sm">{m.metaclean_leaks_found()}</span>
            </div>
          {:else}
            <p class="text-sm text-success">{m.metaclean_leaks_clean()}</p>
          {/if}
        </div>

        <div class="modal-action">
          <button type="button" class="btn btn-ghost" onclick={handleKeepOriginal}>
            {m.metaclean_keep_original()}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            onclick={handleUseCleaned}
            data-testid="metaclean-use-cleaned"
          >
            {m.metaclean_use_cleaned()}
          </button>
        </div>
      {/if}
    </div>
  </dialog>
{/if}
```

Note: check `src/lib/actions/topLayerModal.js` exists (it is used by `ImageSourceChooserModal.svelte`); pass `handleKeepOriginal` as its close callback so Escape/backdrop behaves like "Continue with original".

- [ ] **Step 5: Run component test + paraglide compile**

Run: `pnpm vitest run src/lib/components/__tests__/MetadataCleanerModal.test.js`
Expected: PASS.
Then run `pnpm run check` — expected: no NEW errors introduced by these files (paraglide compiles the new messages; pre-existing repo warnings are fine).

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/shared/MetadataCleanerModal.svelte src/lib/components/__tests__/MetadataCleanerModal.test.js messages/en.json messages/de.json
git commit -m "feat(shared): add MetadataCleanerModal pre-upload review step (#47)"
```

---

### Task 5: Integrate into `LicensedImageInput`

**Files:**
- Modify: `src/lib/components/shared/LicensedImageInput.svelte`
- Test: `src/lib/components/__tests__/LicensedImageInput.metaclean.test.js` (create)

**Interfaces:**
- Consumes: Task 4's `MetadataCleanerModal` (`{ open, file, ondone }`), Task 3's `isSupportedFile`, Task 1's `runtimeConfig.metadataCleaner`.
- Produces: unchanged external props of `LicensedImageInput`.

Integration point: `handleFileSelected` (around line 81). After the type/size validation and before `sha256Hex(file)`, insert the interstitial. The chosen file (original or cleaned) is used for hashing, `pendingFile`, and modal mime/size, so the license modal and Blossom upload operate on the cleaned bytes.

- [ ] **Step 1: Write the failing test**

Create `src/lib/components/__tests__/LicensedImageInput.metaclean.test.js`. Copy the mock preamble (the `vi.hoisted` block and every `vi.mock` call, including the paraglide messages mock) from the existing `src/lib/components/__tests__/LicensedImageInput.test.js`, with two changes: the `$lib/stores/config.svelte.js` mock must include `metadataCleaner`, and a mock for the modal + helper is added.

```js
// @ts-nocheck
/** @vitest-environment jsdom */
// Mock preamble: copy from LicensedImageInput.test.js, then adjust:

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    blossom: { maxFileSize: 5 * 1024 * 1024 },
    metadataCleaner: { enabled: true }
  }
}));

// Replace the cleaner modal with a stub that captures props and lets the
// test resolve the interstitial deterministically.
const modalMocks = vi.hoisted(() => ({
  lastProps: null,
  cleanedFile: null
}));

vi.mock('../shared/MetadataCleanerModal.svelte', async () => {
  const { default: Stub } = await import('./__stubs__/MetadataCleanerModalStub.svelte');
  return { default: Stub };
});
```

Because stubbing a Svelte component is finicky, prefer the simpler, equally valid behavioral test: do NOT stub the modal; instead mock `$lib/helpers/metaclean.js` (as in Task 4's test) and assert on the real modal's rendered UI:

```js
describe('LicensedImageInput metadata cleaner integration', () => {
  it('opens the metadata review before the license modal for supported files', async () => {
    // render component, select a PNG file via the hidden file input
    // (same fireEvent.change technique as LicensedImageInput.test.js)
    // assert: 'Check metadata' (cleaner modal title) is visible,
    //         and the LicenseModal is NOT yet open.
  });

  it('continues to the license modal with the original file when user keeps original', async () => {
    // click 'Continue with original'
    // assert: license modal opens (existing test's assertion for modal title),
    //         sha256Hex mock was called with the original file.
  });

  it('skips the cleaner entirely when config disables it', async () => {
    // Separate test file NOT needed: re-mock config per test via vi.doMock is
    // brittle in jsdom; instead assert the disabled path in the existing
    // LicensedImageInput.test.js suite, which already mocks config WITHOUT
    // metadataCleaner — after the integration, add one assertion there that
    // picking a file goes straight to the license modal (no 'Check metadata').
  });

  it('uses the cleaned file for hashing when user applies cleaning', async () => {
    // set up applyOps/downloadCleaned mocks (Task 4 pattern),
    // click apply, then 'Use cleaned file',
    // assert sha256Hex was called with a File whose text() === 'clean'.
  });
});
```

Write these as real tests (the comments above describe the assertions; implement them with the `render`/`fireEvent`/`waitFor` patterns from Task 4's test and the file-selection technique from `LicensedImageInput.test.js` — dispatch `fireEvent.change` on `getByTestId('licensed-image-file-input')` with `{ target: { files: [file] } }`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/components/__tests__/LicensedImageInput.metaclean.test.js`
Expected: FAIL — no cleaner modal appears (integration not implemented).

- [ ] **Step 3: Implement the integration**

In `src/lib/components/shared/LicensedImageInput.svelte`:

1. Add imports:

```js
import MetadataCleanerModal from './MetadataCleanerModal.svelte';
import { isSupportedFile } from '$lib/helpers/metaclean.js';
```

2. Add state next to the other modal state (plain `let` for the resolver — it must not trigger re-renders):

```js
let cleanerOpen = $state(false);
/** @type {File | null} */
let cleanerFile = $state(null);
/** @type {((file: File) => void) | null} */
let cleanerResolve = null;
```

3. In `handleFileSelected`, right after `uploading = true;` / before `const hash = await sha256Hex(file);`, insert the interstitial and switch all subsequent uses of `file` to `fileToUse`:

```js
    try {
      // Optional metadata review step (metadata-cleaner service). Resolves
      // with the original file when skipped/closed, or the cleaned copy.
      let fileToUse = file;
      if (runtimeConfig.metadataCleaner?.enabled && isSupportedFile(file)) {
        cleanerFile = file;
        cleanerOpen = true;
        fileToUse = await new Promise((resolve) => {
          cleanerResolve = resolve;
        });
        cleanerFile = null;
        if (myToken !== pickToken) return; // a newer pick superseded us
      }

      const hash = await sha256Hex(fileToUse);
      if (myToken !== pickToken) return; // a newer pick superseded us

      pendingFile = fileToUse;
      currentHash = hash;
      modalMime = fileToUse.type;
      modalSize = fileToUse.size;
      // … rest unchanged (findExistingLicense, modalOpen = true)
```

4. Add the modal to the markup (after the existing `<LicenseModal …/>`):

```svelte
<MetadataCleanerModal
  bind:open={cleanerOpen}
  file={cleanerFile}
  ondone={(/** @type {File} */ f) => {
    cleanerResolve?.(f);
    cleanerResolve = null;
  }}
/>
```

- [ ] **Step 4: Run the new test AND the existing suite**

Run: `pnpm vitest run src/lib/components/__tests__/LicensedImageInput.metaclean.test.js src/lib/components/__tests__/LicensedImageInput.test.js src/lib/components/__tests__/LicensedImageInput.test.svelte.js`
Expected: all PASS. The existing tests mock config without `metadataCleaner`, so `runtimeConfig.metadataCleaner?.enabled` is falsy and the legacy path is exercised unchanged (add the one disabled-path assertion from Step 1 there).

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/shared/LicensedImageInput.svelte src/lib/components/__tests__/LicensedImageInput.metaclean.test.js src/lib/components/__tests__/LicensedImageInput.test.js
git commit -m "feat(shared): metadata review step in LicensedImageInput (#47)"
```

---

### Task 6: Integrate into `LicensedFileInput`

**Files:**
- Modify: `src/lib/components/shared/LicensedFileInput.svelte`
- Test: `src/lib/components/__tests__/LicensedFileInput.metaclean.test.js` (create)

**Interfaces:**
- Consumes: same as Task 5.
- Produces: unchanged external props of `LicensedFileInput`.

Integration point: the `handleFiles` loop (around line 231). After the `maxSize` check and before `sha256Hex(file)`, run the interstitial; everything downstream (`descriptor`, `pendingFilesByIndex.set`) uses the resolved file.

- [ ] **Step 1: Write the failing test**

Create `src/lib/components/__tests__/LicensedFileInput.metaclean.test.js`, copying the mock preamble from the existing `LicensedFileInput.test.js` (adjust the config mock to include `metadataCleaner: { enabled: true }`, and mock `$lib/helpers/metaclean.js` as in Task 4). Test cases (implement fully with the render/fireEvent patterns of the existing file — file selection goes through the hidden `input[type=file]`):

1. **Interstitial appears for a supported file (PDF) before the license modal** — select one PDF, assert the cleaner modal title 'Check metadata' renders and the license modal is not yet open; assert `sha256Hex` has NOT been called yet.
2. **Keep original proceeds with original bytes** — click 'Continue with original', assert license modal opens and `sha256Hex` was called with the original File.
3. **Cleaned file replaces the pending file** — apply + 'Use cleaned file', assert `sha256Hex` was called with the cleaned File (text 'clean') and the descriptor row shows the original filename.
4. **Unsupported file skips the interstitial** — select a `.zip` file, assert the license modal opens directly with no 'Check metadata' rendered.
5. **Disabled config skips the interstitial** — covered by the existing `LicensedFileInput.test.js` (config mock without `metadataCleaner`); after integrating, add one assertion there that no 'Check metadata' appears during its upload flow.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/components/__tests__/LicensedFileInput.metaclean.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the integration**

In `src/lib/components/shared/LicensedFileInput.svelte`:

1. Imports:

```js
import MetadataCleanerModal from './MetadataCleanerModal.svelte';
import { isSupportedFile } from '$lib/helpers/metaclean.js';
```

2. State (near the other modal state):

```js
let cleanerOpen = $state(false);
/** @type {File | null} */
let cleanerFile = $state(null);
/** @type {((file: File) => void) | null} */
let cleanerResolve = null;
```

3. In the `handleFiles` loop, replace the top of the per-file body:

```js
      for (const file of filesToUpload) {
        if (file.size > maxSize) {
          throw new Error(`File "${file.name}" exceeds maximum size of ${formatFileSize(maxSize)}`);
        }

        // Optional metadata review step (metadata-cleaner service). Resolves
        // with the original file when skipped/closed, or the cleaned copy.
        let fileToUpload = file;
        if (runtimeConfig.metadataCleaner?.enabled && isSupportedFile(file)) {
          cleanerFile = file;
          cleanerOpen = true;
          fileToUpload = await new Promise((resolve) => {
            cleanerResolve = resolve;
          });
          cleanerFile = null;
        }

        const hash = await sha256Hex(fileToUpload);
```

then switch the remaining uses in the loop body from `file` to `fileToUpload`: the duplicate-skip message (`file.name` → `fileToUpload.name`), the `descriptor` fields (`name`, `type`, `size`), and `pendingFilesByIndex.set(targetIndex, fileToUpload)`.

4. Markup (after `<LicenseModal …/>`):

```svelte
<MetadataCleanerModal
  bind:open={cleanerOpen}
  file={cleanerFile}
  ondone={(/** @type {File} */ f) => {
    cleanerResolve?.(f);
    cleanerResolve = null;
  }}
/>
```

- [ ] **Step 4: Run the new test AND the existing suite**

Run: `pnpm vitest run src/lib/components/__tests__/LicensedFileInput.metaclean.test.js src/lib/components/__tests__/LicensedFileInput.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/shared/LicensedFileInput.svelte src/lib/components/__tests__/LicensedFileInput.metaclean.test.js src/lib/components/__tests__/LicensedFileInput.test.js
git commit -m "feat(shared): metadata review step in LicensedFileInput (#47)"
```

---

### Task 7: Docs, env example, verification

**Files:**
- Modify: `.env.example` (near `OER_PROXY_URL`, line ~373)
- Modify: `CLAUDE.md` (Server API Endpoints list)

- [ ] **Step 1: Document the env var**

`.env.example`, after the OER proxy block:

```bash
# Metadata cleaner (inspect/strip file metadata + compress PDFs before upload).
# Server-side only; when unset the feature is hidden. https://git.edufeed.org/edufeed/metadata-cleaner
METADATA_CLEANER_URL=
```

`CLAUDE.md`, add to the "Server API Endpoints" bullet list:

```markdown
- `/api/metaclean` — metadata-cleaner proxy for the pre-upload review step in `LicensedFileInput`/`LicensedImageInput` (`METADATA_CLEANER_URL`)
```

- [ ] **Step 2: Full verification**

```bash
pnpm run check         # svelte-check: no NEW errors
pnpm run lint          # prettier + eslint clean
pnpm test              # full unit+component suite (known-flaky inbox/DM files excepted)
```

Expected: all new tests pass, no regressions in Licensed*Input suites.

- [ ] **Step 3: Manual smoke test against the real service**

Set `METADATA_CLEANER_URL=https://cleaner.edufeed.org` in the worktree `.env`, run `pnpm run dev`, and in the browser: create-resource flow → attach a PDF (e.g. a Canva export) → verify the review modal shows real metadata, strip + balanced compression works, the verified result renders, and the cleaned file continues into the license modal. Verify a cover-image JPG shows the review step without the compression picker. Verify with `METADATA_CLEANER_URL` unset that no 'Check metadata' step appears.

- [ ] **Step 4: Commit + finish**

```bash
git add .env.example CLAUDE.md
git commit -m "docs: document METADATA_CLEANER_URL and /api/metaclean (#47)"
```

Then use superpowers:finishing-a-development-branch (merge target: `dev`, per repo convention), and comment on issue #47 with the result.
