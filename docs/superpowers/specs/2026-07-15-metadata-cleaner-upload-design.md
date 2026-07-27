# Metadata Cleaner in the Upload Flow — Design

**Date:** 2026-07-15
**Issue:** https://git.edufeed.org/edufeed/edufeed-app/issues/47
**Service:** https://git.edufeed.org/edufeed/metadata-cleaner (deployed at `cleaner.edufeed.org`)

## Motivation

Uploaded files carry hidden metadata: PDFs exported from design tools (Canva
etc.) name the tool in both the DocInfo dictionary and the XMP stream; photos
carry EXIF (potentially GPS). The edufeed metadata-cleaner service inspects and
strips this metadata and can recompress images embedded in PDFs. A user
requested access to it from inside the app's upload flow.

## UX: quiet opt-in flow (revised 2026-07-16)

> **Revision note:** the first shipped iteration auto-opened a full metadata
> review modal for every supported file. User feedback: too prominent and
> confusing for non-technical users. Revised to the quiet flow below — the
> upload pipeline is uninterrupted except for the one case where
> interrupting genuinely helps (oversized PDFs).

The feature is active when the deployment has `METADATA_CLEANER_URL` set and
the file type is supported: PDF, JPG/JPEG, PNG, TIF/TIFF, WebP. It has two
faces:

### 1. Normal files: checkbox in the license modal, silent cleaning

Picking a file goes straight into the license modal, exactly as it did
before the feature existed — no interstitial. For supported files the
license modal shows a compact opt-in block (injected by the Licensed*Input
components as a snippet; `LicenseModal` itself stays generic):

- ☐ **"Remove hidden file metadata (e.g. creator software) before upload"**
  — plain language, **unchecked by default**.
- For PDFs additionally a small compress select: off (default) / balanced /
  strong.
- A **"show details"** link opening `MetadataCleanerModal` in **inspect-only
  mode**: the metadata table grouped by store with sensitive badges plus the
  list of fields the strip would remove — read-only, just a Close button.

On license **Save**, if the checkbox is ticked (and/or compression chosen),
cleaning runs **silently inside the deferred upload step** (`beforeAttest`):
inspect → strip ops → apply (`flatten: true`, `preserveDates: true`) →
download cleaned copy → the **cleaned bytes** go to Blossom, so the kind
1063 attestation references the cleaned file's hash. Afterwards a subtle
confirmation appears on the file row / image field ("hidden metadata
removed (N fields)"). If the cleaner service fails, the **original uploads
anyway** with a small non-blocking note — cleaning never breaks an upload.

### 2. Oversized PDFs: compression-first rescue modal

A PDF over the Blossom upload limit (`BLOSSOM_MAX_FILE_SIZE`, default 5 MB —
an app-side limit only; the Blossom server itself enforces none) is NOT
rejected up front: `MetadataCleanerModal` auto-opens **before** the pipeline,
framed around the user's actual problem:

- Lead message: the file's size vs. the upload limit, and that compression
  may fix it. Compression picker front and center, **balanced preselected**.
- The metadata table and the strip toggle are collapsed behind a
  "show file metadata" toggle (strip stays available, default on, but
  secondary).
- Apply → verified result (sizes, leak scan, still-oversized warning if
  applicable) → "Use cleaned file" continues into the license modal; the
  size check runs on the resolved file. "Continue with original" (also
  Escape/backdrop) proceeds and then fails the size check as before.

Oversized images and unsupported files still fail fast — the service cannot
compress those. The proxy's own body cap is therefore independent:
`METADATA_CLEANER_MAX_UPLOAD_MB` (default 200, matching the service).

All user-facing strings go through Paraglide (DE + EN). Discoverability of
the quiet checkbox may later be helped by a Termi hint card (per the
project's no-page-banners rule) — out of scope here.

## Scope: which uploaders

- **`LicensedFileInput`** (resource wizard attachments, publications) — the
  only surface where PDFs are uploaded, hence the only one showing compression.
- **`LicensedImageInput`** (cover images: resource wizard, article, calendar
  event).

Both components already defer the actual Blossom upload until license
attestation, so swapping the pending `File` object slots in naturally.

**Out of scope** (follow-ups, noted on the issue): `AvatarUploader`,
`BannerUploader`, `MarkdownEditor` inline images; OER provenance writing
(`POST /api/oer-ops` + sidecar) in the resource wizard; standalone image
compression; field-level metadata editing (set/add ops).

## Architecture

### Configuration

- New server-side env var: `METADATA_CLEANER_URL` (e.g.
  `https://cleaner.edufeed.org`). Never exposed to the browser.
- `/api/config` exposes only `metadataCleaner: { enabled: Boolean(env.METADATA_CLEANER_URL) }`
  (same pattern as `oer: { enabled }`).
- `config.svelte.js`: default `metadataCleaner: { enabled: false }`, deep-merge
  entry, `runtimeConfig.metadataCleaner` getter.
- Feature fully hidden when unset; proxy answers 503.

### Server proxy: `src/routes/api/metaclean/[...path]/+server.js`

The cleaner sends no CORS headers, so the browser cannot call it directly. A
single catch-all SvelteKit endpoint forwards requests, with a **strict
allowlist**:

| Method | App path | Upstream |
| --- | --- | --- |
| POST | `/api/metaclean/files` | `POST /api/files` (multipart upload → session + fields) |
| GET | `/api/metaclean/files/{id}/ops/strip` | `GET /api/files/{id}/ops/strip` |
| POST | `/api/metaclean/files/{id}/apply` | `POST /api/files/{id}/apply` |
| GET | `/api/metaclean/files/{id}/download` | `GET /api/files/{id}/download` |

- Session ids are validated (`[A-Za-z0-9_-]+`) before path interpolation.
- Any other path/method → 404. `METADATA_CLEANER_URL` unset → 503
  (same contract as `/api/oer`).
- Request bodies and response bodies are streamed through; upstream status
  codes and `Content-Type`/`Content-Disposition` headers pass through.
- Upstream size limits apply (service default: 200 MB uploads).

### Client helper: `src/lib/helpers/metaclean.js`

Thin wrapper with injectable `fetch` (test pattern from
`src/lib/helpers/oer/searchOer.js`):

- `inspectFile(file)` → `{ sessionId, filename, fields }`
- `getStripOps(sessionId)` → `{ ops }`
- `applyOps(sessionId, { ops, compress })` → apply response (before/after
  fields, leaks, sizes, compression stats, downloadUrl)
- `downloadCleaned(sessionId, filename, type)` → `File`
- `isSupportedFile(file)` → boolean (by MIME type / extension)

### UI component: `src/lib/components/shared/MetadataCleanerModal.svelte`

Props: `file: File`, `open` (bindable), `onUseCleaned(file: File)`.
Internally: inspect on open → field list grouped by store → strip toggle +
compress select (PDF only) → apply → result view → use/keep buttons.

Integration points:

- `LicensedFileInput.svelte`: per selected pending file (inside the
  sequential upload loop), the interstitial opens when supported; the resolved
  file replaces the pending entry before hashing.
- `LicensedImageInput.svelte`: same interstitial for a chosen upload file before the
  license modal runs `performUpload()`.

## Error handling

- Proxy unset/unreachable → modal error state with retry + "Keep original".
- Upstream errors are surfaced as JSON `{error}` messages (service contract);
  the modal shows the message and never blocks the plain upload path.
- Session expiry (service TTL 15 min): apply/download 404 → modal offers
  re-inspect (new session).

## Testing

- **Unit (node):** `/api/config` exposure of `metadataCleaner.enabled`; proxy
  route (allowlist, 503-when-unconfigured, forwarding, session-id validation);
  `metaclean.js` helper against a mocked fetch.
- **Component (jsdom):** `MetadataCleanerModal` — renders fields grouped by
  store, sensitive flags, strip/compress controls, apply result, callbacks.
- **No E2E** — depends on an external service.
