# Metadata Cleaner Quiet Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the auto-opening metadata review modal with a quiet opt-in flow: a checkbox in the license modal with silent cleaning, an inspect-only details view, and a compression-first rescue modal reserved for oversized PDFs.

**Architecture:** `MetadataCleanerModal` gains a `mode: 'review' | 'inspect'` prop and an oversized compression-first layout. `LicenseModal` gains a generic optional `extraOptions` snippet prop. The two `Licensed*Input` components stop auto-opening the modal for normal files, render the opt-in checkbox (+ PDF compress select + "show details" link) into the license modal via the snippet, and run `cleanFileQuietly()` inside their deferred-upload (`beforeAttest`) step so the cleaned bytes are what reaches Blossom.

**Spec:** `docs/superpowers/specs/2026-07-15-metadata-cleaner-upload-design.md` (section "UX: quiet opt-in flow (revised 2026-07-16)") · **Issue:** https://git.edufeed.org/edufeed/edufeed-app/issues/47

## Global Constraints

- Svelte 5 runes; plain `let` for promise resolvers; `$state.raw` for service payload arrays; JS + JSDoc only.
- Paraglide keys prefixed `metaclean_`, present in BOTH `messages/en.json` and `messages/de.json`; no literal `@` before `{param}`. Remove keys that become unused (lint-staged runs `scripts/check-i18n-keys.sh`).
- DaisyUI semantic classes only.
- Cleaning must NEVER break an upload: any cleaner failure falls back to uploading the original file plus a non-blocking note.
- The license attestation (kind 1063) must reference the hash of the bytes actually uploaded — this already holds because `beforeAttest`'s return value supplies `{url, hash, mime, size}` from the uploaded blob; silent cleaning must happen BEFORE `client.uploadBlob(...)` inside `beforeAttest`.
- Behavior when `metadataCleaner.enabled` is false: byte-identical to pre-feature flow (no checkbox, no modal, no notes).
- Oversized-PDF rescue mechanics (interstitial before hashing, deferred size check, `METADATA_CLEANER_MAX_UPLOAD_MB` proxy cap) are KEPT — only the modal's presentation changes.
- TDD; test commands: `pnpm vitest run <paths>`; existing suites in `src/lib/components/__tests__/` show the mock preambles to reuse.
- Commit style `feat(scope):` / `test(scope):` / `refactor(scope):` with `(#47)`.

---

### Task 1: Helper `cleanFileQuietly`

**Files:**
- Modify: `src/lib/helpers/metaclean.js`
- Test: `src/lib/__tests__/metaclean-helper.test.js` (extend)

**Interfaces:**
- Produces: `cleanFileQuietly(file, { strip = true, compress } = {}, fetchImpl = fetch): Promise<{ file: File, removedCount: number, cleaned: boolean } | null>`
  - Nothing to do (no strip ops found AND compress off/absent) → `{ file: <original>, removedCount: 0, cleaned: false }` without calling apply/download.
  - Success → `{ file: <cleaned File with original name/type>, removedCount: <number of delete ops>, cleaned: true }`.
  - ANY error (inspect/ops/apply/download) → `null` (caller uploads the original).

- [ ] **Step 1: Failing tests** — extend `metaclean-helper.test.js` with a `describe('cleanFileQuietly', ...)`: (a) full clean path: mocked fetch responses for inspect (sessionId `s1`), strip ops (1 delete op), apply, download (`Response(new Blob(['clean']))`) → resolves `{ removedCount: 1, cleaned: true }` and `file.text() === 'clean'`, `file.name`/`type` preserved; assert apply body has `flatten: true`, `preserveDates: true` and NO `compress` when `compress: 'off'`; (b) `strip: false, compress: 'balanced'` → apply called with `ops: []` and `compress: 'balanced'`; (c) nothing-to-do: strip ops empty + compress off → returns original file object identity, `cleaned: false`, and fetch was called exactly twice (inspect + ops, no apply/download); (d) failure: inspect rejects → resolves `null` (no throw).
- [ ] **Step 2: Run to verify FAIL** — `pnpm vitest run src/lib/__tests__/metaclean-helper.test.js`
- [ ] **Step 3: Implement** in `metaclean.js` (composing the existing exported functions, passing `fetchImpl` through; wrap everything in try/catch returning null):

```js
/**
 * One-shot silent clean for the license-modal opt-in: strip provenance
 * and/or compress, returning the cleaned File. Never throws — any service
 * failure returns null and the caller uploads the original instead.
 * @param {File} file
 * @param {{ strip?: boolean, compress?: 'off' | 'balanced' | 'strong' }} [options]
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ file: File, removedCount: number, cleaned: boolean } | null>}
 */
export async function cleanFileQuietly(file, { strip = true, compress } = {}, fetchImpl = fetch) {
  try {
    const { sessionId } = await inspectFile(file, fetchImpl);
    const ops = strip ? ((await getStripOps(sessionId, fetchImpl)).ops ?? []) : [];
    const wantsCompress = Boolean(compress && compress !== 'off');
    if (ops.length === 0 && !wantsCompress) {
      return { file, removedCount: 0, cleaned: false };
    }
    await applyOps(sessionId, { ops, compress }, fetchImpl);
    const cleaned = await downloadCleaned(sessionId, file.name, file.type, fetchImpl);
    return { file: cleaned, removedCount: ops.length, cleaned: true };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run to verify PASS**, then **Step 5: Commit** `feat(shared): add cleanFileQuietly silent-clean helper (#47)`

---

### Task 2: `MetadataCleanerModal` — inspect mode + compression-first oversized layout

**Files:**
- Modify: `src/lib/components/shared/MetadataCleanerModal.svelte`
- Modify: `messages/en.json`, `messages/de.json`
- Test: `src/lib/components/__tests__/MetadataCleanerModal.test.js` (extend/adjust)

**Interfaces:**
- Produces: new prop `mode?: 'review' | 'inspect'` (default `'review'`).
  - `inspect`: after inspection, render the metadata table (grouped, sensitive badges) plus an informational "fields that would be removed" list (from strip ops); NO strip toggle, NO compress select, NO apply; single primary **Close** button (`data-testid="metaclean-inspect-close"`) that sets `open = false` and calls `ondone(file)` via the existing `finish()`. Error phase keeps Retry + close.
  - `review` + oversized (`file.size > maxSize`): lead alert `metaclean_oversized_lead({ size, limit })` replaces `metaclean_oversized_hint`; `compress` preselected to `'balanced'` when the inspected file is an oversized PDF; the metadata table AND the strip toggle/field list move inside a `<details>` element whose `<summary>` is `metaclean_show_metadata()` (`data-testid="metaclean-details-toggle"`), collapsed by default; compress select + subtitle stay visible. Strip stays default-on.
  - `review` non-oversized: unchanged layout.

**i18n changes** (both locales; remove `metaclean_oversized_hint` — it becomes unused):

```json
"metaclean_oversized_lead": "This file is {size} — the upload limit is {limit}. Compression can shrink it below the limit.",
"metaclean_show_metadata": "Show file metadata",
"metaclean_inspect_title": "File metadata",
"metaclean_inspect_removes": "Selecting \"remove hidden metadata\" would remove these fields:",
"metaclean_close": "Close"
```

```json
"metaclean_oversized_lead": "Diese Datei ist {size} groß — das Upload-Limit ist {limit}. Die Komprimierung kann sie unter das Limit verkleinern.",
"metaclean_show_metadata": "Datei-Metadaten anzeigen",
"metaclean_inspect_title": "Datei-Metadaten",
"metaclean_inspect_removes": "\"Versteckte Metadaten entfernen\" würde diese Felder entfernen:",
"metaclean_close": "Schließen"
```

(Inspect mode uses `metaclean_inspect_title` as the h3 instead of `metaclean_title`.)

- [ ] **Step 1: Failing tests** — adjust/extend `MetadataCleanerModal.test.js` (update the paraglide mock with the new keys, drop `metaclean_oversized_hint`):
  1. inspect mode: renders `File metadata` title, the field table (`Canva`), the would-remove list, NO `metaclean-apply`/`metaclean-compress`/strip toggle; clicking `metaclean-inspect-close` fires `ondone` once with the original file, `applyOps` never called.
  2. oversized review (PDF, `maxSize` below size): shows the oversized lead text; `metaclean-compress` select value is `'balanced'`; the field table is inside a collapsed `<details>` (assert the `details` element exists and lacks the `open` attribute, and `metaclean-details-toggle` is rendered).
  3. Existing "shows an oversized hint" test: update to the new lead text; existing non-oversized tests keep passing unchanged (table visible without a `<details>` wrapper in non-oversized review).
- [ ] **Step 2: Run to verify FAIL** — `pnpm vitest run src/lib/components/__tests__/MetadataCleanerModal.test.js`
- [ ] **Step 3: Implement.** Sketch of the structural changes (adapt precisely to the existing file):
  - Props: `let { open = $bindable(false), file = null, ondone = () => {}, maxSize = null, mode = 'review' } = $props();`
  - In `runInspect`, after `stripOps` are set: `compress = oversized && isPdf ? 'balanced' : 'off';` (compute from the same deriveds; note `compress` reset currently happens at the top of `runInspect` — move/adjust so the preselect wins).
  - Template: title `{mode === 'inspect' ? m.metaclean_inspect_title() : m.metaclean_title()}`. In the review/applying branch, when `mode === 'inspect'` render table + would-remove list + Close button only. When `mode === 'review' && oversized`, wrap table + strip block in `<details class="mt-4"><summary class="cursor-pointer text-sm font-medium" data-testid="metaclean-details-toggle">{m.metaclean_show_metadata()}</summary>…</details>` and show the lead alert instead of the old hint.
- [ ] **Step 4: Run to verify PASS** (whole file), then **Step 5: Commit** `feat(shared): inspect mode + compression-first oversized layout for MetadataCleanerModal (#47)`

---

### Task 3: `LicenseModal` — optional `extraOptions` snippet

**Files:**
- Modify: `src/lib/components/shared/LicenseModal.svelte`
- Test: `src/lib/components/__tests__/LicenseModal.metaclean.test.js` (create, small)

**Interfaces:**
- Produces: optional prop `extraOptions` (Svelte 5 snippet, default `null`). Rendered in the **create-own-license form branch only** (not the accept-existing branch), directly above the disclosure checkbox block (`license-modal-disclosure`), wrapped as:

```svelte
{#if extraOptions}
  <div class="mt-4 mb-3 rounded-lg border border-base-300 bg-base-200/50 p-3">
    {@render extraOptions()}
  </div>
{/if}
```

- All existing consumers pass nothing → zero change for them.

- [ ] **Step 1: Failing test** — new small jsdom test: render LicenseModal open (copy the minimal mock preamble from `LicenseModal.test.js`) with an `extraOptions` snippet (use `createRawSnippet` from `'svelte'` rendering `<span>EXTRA-OPT</span>`), assert the text renders inside the modal and ABOVE the disclosure checkbox in DOM order; second test: without the prop nothing extra renders.
- [ ] **Step 2: FAIL** → **Step 3: implement** (add prop + render block) → **Step 4: PASS** (also run `pnpm vitest run src/lib/components/__tests__/LicenseModal.test.js src/lib/components/__tests__/LicenseModal.test.svelte.js` for regressions) → **Step 5: Commit** `feat(shared): optional extraOptions snippet slot in LicenseModal (#47)`

---

### Task 4: `LicensedFileInput` rework

**Files:**
- Modify: `src/lib/components/shared/LicensedFileInput.svelte`
- Modify: `messages/en.json`, `messages/de.json`
- Test: `src/lib/components/__tests__/LicensedFileInput.metaclean.test.js` (rewrite)

**Interfaces:**
- Consumes: Task 1 `cleanFileQuietly`, Task 2 modal modes, Task 3 `extraOptions`.
- External props unchanged. The `UploadedFileWithLicense` descriptor gains optional `metaCleanedFields?: number` and `metaCleanFailed?: boolean` (display-only).

**Behavior changes:**
1. **Interstitial gating:** the pre-hash interstitial opens ONLY for `cleanerEligible && isPdfFile(file) && file.size > maxSize` (the rescue case). Normal supported files skip straight to the license flow. The deferred size check on the resolved file stays.
2. **New state** (reset per file before `openModalFor`): `let cleanMetadata = $state(false); let cleanCompress = $state('off'); let inspectOpen = $state(false);`
3. **Snippet** rendered into `LicenseModal` via `extraOptions` — only when the current modal target has a pending upload AND is supported:

```svelte
{#snippet metacleanOptions()}
  <label class="flex cursor-pointer items-start gap-2 text-sm">
    <input type="checkbox" class="checkbox mt-0.5 checkbox-sm" bind:checked={cleanMetadata}
      data-testid="metaclean-license-checkbox" />
    <span class="whitespace-normal">{m.metaclean_license_checkbox()}</span>
  </label>
  {#if modalTargetPendingFile && isPdfFile(modalTargetPendingFile)}
    <label class="mt-2 flex items-center gap-2 text-sm">
      <span>{m.metaclean_compress_label()}</span>
      <select class="select-bordered select select-xs" bind:value={cleanCompress}
        data-testid="metaclean-license-compress">
        <option value="off">{m.metaclean_compress_off()}</option>
        <option value="balanced">{m.metaclean_compress_balanced()}</option>
        <option value="strong">{m.metaclean_compress_strong()}</option>
      </select>
    </label>
  {/if}
  <button type="button" class="btn mt-1 btn-ghost btn-xs" data-testid="metaclean-license-details"
    onclick={() => (inspectOpen = true)}>
    {m.metaclean_license_details()}
  </button>
{/snippet}
```

with `const modalTargetPendingFile = $derived(modalTargetIndex !== null ? (pendingFilesByIndex.get(modalTargetIndex) ?? null) : null);` and the LicenseModal prop `extraOptions={runtimeConfig.metadataCleaner?.enabled && modalTargetPendingFile && isSupportedFile(modalTargetPendingFile) ? metacleanOptions : null}`.
4. **Inspect modal** (second `MetadataCleanerModal` instance, mode `inspect`): `<MetadataCleanerModal bind:open={inspectOpen} file={modalTargetPendingFile} mode="inspect" />`.
5. **Silent clean in `makeBeforeAttest(index)`** — before `client.uploadBlob(file)`:

```js
let uploadFile = file;
let cleanedFields = 0;
let cleanFailed = false;
if (cleanMetadata || cleanCompress !== 'off') {
  const result = await cleanFileQuietly(uploadFile, {
    strip: cleanMetadata,
    compress: cleanCompress
  });
  if (result) {
    uploadFile = result.file;
    cleanedFields = result.cleaned ? result.removedCount : 0;
  } else {
    cleanFailed = true; // service down — upload the original, note it
  }
}
const blob = await client.uploadBlob(uploadFile);
```

and extend the existing `files = files.map(...)` slot update with `metaCleanedFields: cleanedFields, metaCleanFailed: cleanFailed`.
6. **Row notes** (under the name/meta block, next to the LicenseBadge area):

```svelte
{#if file.metaCleanedFields}
  <div class="text-xs text-success">{m.metaclean_removed_note({ count: String(file.metaCleanedFields) })}</div>
{:else if file.metaCleanFailed}
  <div class="text-xs text-warning">{m.metaclean_clean_failed_note()}</div>
{/if}
```

**i18n** (both locales):

```json
"metaclean_license_checkbox": "Remove hidden file metadata (e.g. creator software) before upload",
"metaclean_license_details": "Show details",
"metaclean_removed_note": "Hidden metadata removed ({count} fields)",
"metaclean_clean_failed_note": "Metadata could not be removed — the original file was uploaded."
```

```json
"metaclean_license_checkbox": "Versteckte Datei-Metadaten (z. B. Erstellungssoftware) vor dem Hochladen entfernen",
"metaclean_license_details": "Details anzeigen",
"metaclean_removed_note": "Versteckte Metadaten entfernt ({count} Felder)",
"metaclean_clean_failed_note": "Metadaten konnten nicht entfernt werden — die Originaldatei wurde hochgeladen."
```

- [ ] **Step 1: Rewrite the test file (failing first).** Keep the mock preamble; mock `cleanFileQuietly` in the `$lib/helpers/metaclean.js` mock (importActual for the rest). Cases:
  1. Normal PDF: NO 'Check metadata' interstitial; license modal opens directly and contains `metaclean-license-checkbox` + `metaclean-license-compress` + `metaclean-license-details`.
  2. Save with checkbox ticked: tick disclosure + metaclean checkbox, click `license-modal-save` → `cleanFileQuietly` called with the pending file and `{ strip: true, compress: 'off' }`; `uploadBlob` called with the CLEANED file (mock `cleanFileQuietly` to resolve `{ file: new File(['clean'], …), removedCount: 2, cleaned: true }`; assert uploaded file text `'clean'`); row shows 'Hidden metadata removed (2 fields)'.
  3. Save with checkbox unticked and compress off: `cleanFileQuietly` NOT called; `uploadBlob` gets the original.
  4. Cleaner failure: `cleanFileQuietly` resolves `null` → `uploadBlob` gets the ORIGINAL file and the row shows the failure note; save still succeeds.
  5. 'Show details' opens the inspect modal (`File metadata` title, no `metaclean-apply`).
  6. Oversized PDF: interstitial still auto-opens with the oversized lead text (reuse/adapt the existing oversized tests; balanced preselect asserted in Task 2's suite).
  7. Unsupported file (`.zip`): no checkbox in the license modal (extraOptions absent).
  8. Keep the existing disabled-config assertion in `LicensedFileInput.test.js` green (no checkbox, no interstitial when `metadataCleaner` missing from config).
- [ ] **Step 2: FAIL** → **Step 3: implement** → **Step 4:** `pnpm vitest run src/lib/components/__tests__/LicensedFileInput.metaclean.test.js src/lib/components/__tests__/LicensedFileInput.test.js` all PASS → **Step 5: Commit** `feat(shared): quiet metaclean opt-in in LicensedFileInput license flow (#47)`

---

### Task 5: `LicensedImageInput` rework

**Files:**
- Modify: `src/lib/components/shared/LicensedImageInput.svelte`
- Test: `src/lib/components/__tests__/LicensedImageInput.metaclean.test.js` (rewrite)

**Interfaces:** consumes the same pieces. External props unchanged.

**Behavior changes:**
1. **Remove the interstitial entirely** (images can't be compressed; oversized images keep failing fast at the existing early check). Delete `cleanerOpen`/`cleanerFile`/`cleanerResolve` and the awaited-promise block in `handleFileSelected`; restore direct `sha256Hex(file)` on the picked file.
2. Add `cleanMetadata` / `inspectOpen` state (no compress — images only), reset on each `handleFileSelected`.
3. Same `metacleanOptions` snippet (checkbox + details link, no compress select), passed to its `LicenseModal` when `runtimeConfig.metadataCleaner?.enabled && pendingFile && isSupportedFile(pendingFile)`.
4. `performUpload()`: same silent-clean insertion before `client.uploadBlob(pendingFile)` (operate on a local `uploadFile` variable; keep `pendingFile` untouched on failure). Store `metaCleanedFields`/`metaCleanFailed` in component state (`let metaCleanedFields = $state(0); let metaCleanFailed = $state(false);`, reset per pick).
5. Confirmation note under the field (near the LicenseBadge row):

```svelte
{#if metaCleanedFields}
  <p class="mt-1 text-xs text-success">{m.metaclean_removed_note({ count: String(metaCleanedFields) })}</p>
{:else if metaCleanFailed}
  <p class="mt-1 text-xs text-warning">{m.metaclean_clean_failed_note()}</p>
{/if}
```

6. Inspect modal instance: `<MetadataCleanerModal bind:open={inspectOpen} file={pendingFile} mode="inspect" />`.

- [ ] **Step 1: Rewrite test file (failing first).** Cases: (1) picking a PNG opens the license modal directly (no 'Check metadata'); checkbox present, NO compress select; (2) save with checkbox → `uploadBlob` receives cleaned file, success note renders; (3) checkbox off → `cleanFileQuietly` not called, original uploaded; (4) failure → original uploaded + warning note; (5) details link opens inspect modal.
- [ ] **Step 2: FAIL** → **Step 3: implement** → **Step 4:** run new file + `LicensedImageInput.test.js` + `LicensedImageInput.test.svelte.js` all PASS → **Step 5: Commit** `feat(shared): quiet metaclean opt-in in LicensedImageInput license flow (#47)`

---

### Task 6: Docs + full verification

**Files:**
- Modify: `README.md` (Metadata Cleaner section: replace the review-step description with checkbox-flow + oversized-rescue wording)
- Modify: `docs/superpowers/specs/…` only if implementation deviated

- [ ] **Step 1:** Update the README section's first paragraph to describe the quiet flow (checkbox in the license dialog, silent clean, oversized-PDF compression modal). Env var docs unchanged.
- [ ] **Step 2:** `pnpm run check` (no NEW errors), `pnpm run lint`, `pnpm test` (full; known-flaky inbox/DM files and the pre-existing `MembershipApprovalsPanel.test.js` failure excepted).
- [ ] **Step 3:** Commit `docs: describe quiet metaclean flow in README (#47)`.
- [ ] **Step 4 (controller, not subagent):** live browser smoke test against the real service: normal PDF → no interruption, checkbox visible, ticked → uploaded file is cleaned (verify via the row note); oversized PDF → compression-first modal with balanced preselected; details link → read-only view.
