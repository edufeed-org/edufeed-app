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

## UX: optional review step

After a file is selected in a supported upload component — and **before** the
Blossom upload happens — the review step opens automatically as an
**interstitial modal** when:

- the feature is enabled (deployment has `METADATA_CLEANER_URL` set), and
- the file type is supported: PDF, JPG/JPEG, PNG, TIF/TIFF, WebP.

(The upload components have no resting "picked but not uploaded" UI state
where a separate "Check metadata" button could live — picking a file
immediately enters the license-modal pipeline — so the review step is shown
as the first modal in that pipeline instead. Cleaning stays strictly
opt-in: nothing is modified without an explicit action, and **"Continue
with original"** is a single click.)

The shared **`MetadataCleanerModal`**:

1. The file is uploaded to the cleaner (via the app's server proxy). All
   metadata is displayed, grouped by store (DocInfo / XMP / EXIF / IPTC / PNG /
   Other), with sensitive fields visually flagged (the service marks them).
2. The user can enable **"Remove tool provenance"** — the service's `strip`
   preset, shown as the concrete list of fields that will be deleted — and,
   **for PDFs only**, pick a compression preset: off (default) / balanced /
   strong.
3. **Apply** runs the operations (`flatten: true`, `preserveDates: true`, like
   the service's own UI) and shows the verified result: metadata before/after,
   file size before/after, and the leak-scan result.
4. **"Use cleaned file"** downloads the cleaned copy and replaces the pending
   `File` in the upload component; the normal flow (license attestation →
   Blossom upload) continues with the cleaned copy — sha256/size are computed
   downstream from it as usual. **"Keep original"** closes the modal with no
   changes.

"Continue with original" (also Escape or a backdrop click) proceeds exactly
as today. If the service is unreachable or errors, the modal shows a
friendly error; uploading the original still works (graceful degradation).

All user-facing strings go through Paraglide (DE + EN).

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
