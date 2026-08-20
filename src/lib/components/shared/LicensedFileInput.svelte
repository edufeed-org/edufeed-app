<!--
  LicensedFileInput
  Multi-file Blossom uploader with per-file NIP-94 (kind 1063) license attestation.
  Each uploaded file gets its own license modal flow — modals open sequentially so
  the user attends to one file at a time.
-->

<script>
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { TimelineModel } from 'applesauce-core/models';
  import { CloseIcon, PlusIcon } from '$lib/components/icons';
  import { BlossomClient } from 'blossom-client-sdk';
  import { getActiveBlossomServer } from '$lib/services/blossom-settings-service.js';
  import { createBlossomServerLoader } from '$lib/loaders/blossom-server-loader.js';
  import { getRelayListLookupRelays } from '$lib/services/relay-service.svelte.js';
  import { findExistingLicense, getLicenseUrl } from '$lib/helpers/image-license.js';
  import { reconcileBlobUrlScheme } from '$lib/helpers/blossom-trust.js';
  import { sha256Hex } from '$lib/helpers/sha256.js';
  import { SvelteMap } from 'svelte/reactivity';
  import LicenseBadge from './LicenseBadge.svelte';
  import LicenseModal from './LicenseModal.svelte';
  import MetadataCleanerModal from './MetadataCleanerModal.svelte';
  import { isPdfFile, isSupportedFile, cleanFileQuietly } from '$lib/helpers/metaclean.js';
  import { isInteractiveCandidate } from '$lib/webxdc/interactive-detect.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} UploadedFileWithLicense
   * @property {string} url
   * @property {string} name
   * @property {string} type
   * @property {number} size
   * @property {string} [sha256]
   * @property {any} [licenseEvent]
   * @property {number} [metaCleanedFields] - display-only: hidden metadata fields removed on upload
   * @property {boolean} [metaCleanFailed] - display-only: quiet clean was requested but the service failed
   */

  /** @type {{ files?: UploadedFileWithLicense[], multiple?: boolean, accept?: string, maxSize?: number, label?: string, helpText?: string, disabled?: boolean, activeUserDisplayName?: string, detectInteractive?: boolean }} */
  let {
    files = $bindable([]),
    multiple = true,
    accept = '*/*',
    maxSize = runtimeConfig.blossom.maxFileSize,
    label = '',
    helpText = '',
    disabled = false,
    activeUserDisplayName = '',
    detectInteractive = false
  } = $props();

  // ---------------------------------------------------------------------------
  // Upload UI state
  // ---------------------------------------------------------------------------
  let isDragging = $state(false);
  let isUploading = $state(false);
  let uploadProgress = $state(0);
  let uploadError = $state(/** @type {string | null} */ (null));
  /** @type {HTMLInputElement | null} */
  let fileInputRef = null;

  // Active user (kept reactive so blossom server lookup works after login)
  let activeUser = $state(manager.active);
  $effect(() => {
    const sub = manager.active$.subscribe((user) => {
      activeUser = user;
    });
    return () => sub.unsubscribe();
  });

  // Hydrate user's kind 10063 list so getActiveBlossomServer can find it.
  $effect(() => {
    if (!activeUser?.pubkey) return;
    const lookupRelays = getRelayListLookupRelays();
    const loader = createBlossomServerLoader(pool, lookupRelays, eventStore, activeUser.pubkey);
    const sub = loader()().subscribe();
    return () => sub?.unsubscribe();
  });

  // ---------------------------------------------------------------------------
  // Modal state — single modal instance, retargeted per file via modalTargetIndex
  // ---------------------------------------------------------------------------
  let modalOpen = $state(false);
  let modalTargetIndex = $state(/** @type {number | null} */ (null));

  // Optional metadata review interstitial (metadata-cleaner service), run
  // per-file inside the handleFiles loop before hashing.
  let cleanerOpen = $state(false);
  /** @type {File | null} */
  let cleanerFile = $state(null);
  /** @type {((file: File) => void) | null} */
  let cleanerResolve = null;

  // Quiet metaclean opt-in, surfaced as extra options inside the license
  // modal (see metacleanOptions snippet below) instead of a blocking
  // interstitial. Cleaning itself happens silently in makeBeforeAttest.
  let cleanMetadata = $state(false);
  /** @type {'off' | 'balanced' | 'strong'} */
  let cleanCompress = $state('off');
  let inspectOpen = $state(false);

  // ---------------------------------------------------------------------------
  // Interactive (webxdc) detection — only active with `detectInteractive`.
  // Prepared packages are kept per slot index for modal prefill, deferred
  // icon+package upload, and the inline preview.
  // ---------------------------------------------------------------------------
  /** @type {SvelteMap<number, import('$lib/webxdc/interactive-upload.js').PreparedInteractivePackage>} */
  let interactiveBySlot = new SvelteMap();
  /** @type {SvelteMap<number, string>} Icon URLs, filled during beforeAttest. */
  let interactiveIconUrls = new SvelteMap();
  let interactiveSizeWarning = $state(false);
  /** Slot index whose inline webxdc preview is open, or null. */
  let previewIndex = $state(/** @type {number | null} */ (null));

  // .html confirm interstitial (same promise pattern as the metadata cleaner):
  // resolves true = wrap as app, false = plain file.
  let htmlConfirmOpen = $state(false);
  let htmlConfirmName = $state('');
  /** @type {((wrap: boolean) => void) | null} */
  let htmlConfirmResolve = null;

  /** @param {boolean} wrap */
  function answerHtmlConfirm(wrap) {
    htmlConfirmOpen = false;
    htmlConfirmResolve?.(wrap);
    htmlConfirmResolve = null;
  }

  /**
   * Run a picked file through the interactive pipeline when it is a
   * candidate. Returns the prepared package, or null when the file should
   * continue as a plain upload. Throws when a candidate package is invalid.
   * @param {File} file
   */
  async function maybePrepareInteractive(file) {
    if (!detectInteractive) return null;
    const kind = isInteractiveCandidate(file.name);
    if (!kind) return null;
    if (kind === 'html') {
      htmlConfirmName = file.name;
      htmlConfirmOpen = true;
      const wrap = await new Promise((resolve) => {
        htmlConfirmResolve = resolve;
      });
      if (!wrap) return null;
    }
    const { prepareInteractivePackage } = await import('$lib/webxdc/interactive-upload.js');
    return await prepareInteractivePackage(file);
  }

  // Snapshot of `files` taken just before a brand-new upload appends/replaces.
  // Set ONLY when the modal is being opened for a mandatory (upload-loop) flow.
  // Null when the modal was opened from a row button (optional, replace-only
  // flow) — in which case cancel must NOT mutate `files`.
  let preFileSnapshot = $state(/** @type {any[] | null} */ (null));

  // Existing license event (if any) for the file currently targeted by the modal.
  /** @type {any} */
  let pendingExistingLicense = $state(null);

  const modalTargetFile = $derived(modalTargetIndex !== null ? files[modalTargetIndex] : null);

  // Callbacks that resolve the Promise the upload loop is awaiting. Cleared on
  // every notifyModalClosed() — guarantees a fresh listener per upload, no leaks.
  /** @type {Array<(value?: unknown) => void>} */
  let modalCloseListeners = [];

  /** Stashed File objects waiting for modal Save (mandatory upload-loop flow). */
  /** @type {SvelteMap<number, File>} */
  let pendingFilesByIndex = new SvelteMap();

  // The pending (not-yet-uploaded) File for the current modal target, if any —
  // used to gate the metaclean options and feed the inspect modal.
  const modalTargetPendingFile = $derived(
    modalTargetIndex !== null ? (pendingFilesByIndex.get(modalTargetIndex) ?? null) : null
  );

  // Prepared interactive package for the current modal target — drives the
  // license-modal prefill and the dual-purpose (NIP-DC) attestation extras.
  const interactiveForModal = $derived(
    modalTargetIndex !== null ? (interactiveBySlot.get(modalTargetIndex) ?? null) : null
  );
  const interactiveAttestExtras = $derived(
    interactiveForModal && modalTargetIndex !== null
      ? {
          alt: `Webxdc app: ${interactiveForModal.name}`,
          image: interactiveIconUrls.get(modalTargetIndex) ?? ''
        }
      : undefined
  );

  function notifyModalClosed() {
    const listeners = modalCloseListeners;
    modalCloseListeners = [];
    for (const l of listeners) l();
  }

  // Caller is responsible for assigning preFileSnapshot before opening:
  // - Upload loop (mandatory): set to the pre-append array (so cancel reverts).
  // - Row-button (optional): set to null (cancel must not mutate files).
  function openModalFor(/** @type {number} */ index) {
    modalTargetIndex = index;
    // Reset per-file so a re-opened modal (row "add license" button) never
    // inherits a previous file's opt-in state.
    cleanMetadata = false;
    cleanCompress = 'off';
    inspectOpen = false;
    modalOpen = true;
  }

  // ---------------------------------------------------------------------------
  // Reactive license lookup for already-uploaded files (edit-flow rehydration)
  // ---------------------------------------------------------------------------
  // For each file with a sha256 but no licenseEvent, subscribe to kind-1063
  // events that reference that hash via #x. Newest wins (tie-break by id).
  $effect(() => {
    /** @type {import('rxjs').Subscription[]} */
    const subs = [];
    files.forEach((file, index) => {
      if (!file.sha256 || file.licenseEvent) return;
      const hash = file.sha256;
      const sub = eventStore
        .model(TimelineModel, { kinds: [1063], '#x': [hash] })
        .subscribe((events) => {
          if (!events || events.length === 0) return;
          const winner = [...events].sort((a, b) => {
            if (b.created_at !== a.created_at) return b.created_at - a.created_at;
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
          })[0];
          if (!winner) return;
          // Guard against stale closure: only assign if this slot still has the
          // same hash and still lacks a license event.
          const cur = files[index];
          if (cur && cur.sha256 === hash && !cur.licenseEvent) {
            files = files.map((f, i) => (i === index ? { ...f, licenseEvent: winner } : f));
          }
        });
      subs.push(sub);
    });
    return () => {
      for (const s of subs) s.unsubscribe();
    };
  });

  // ---------------------------------------------------------------------------
  // File icon + size helpers (pure formatters)
  // ---------------------------------------------------------------------------
  /**
   * Format file size for display
   * @param {number} bytes
   * @returns {string}
   */
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Get file icon based on MIME type
   * @param {string} mimeType
   * @returns {string}
   */
  function getFileIcon(mimeType) {
    if (mimeType === 'application/x-webxdc') return '🧩';
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📄';
    if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📽️';
    if (mimeType.includes('zip') || mimeType.includes('archive')) return '📦';
    return '📎';
  }

  /**
   * Display name for a file row.
   * If the file has a kind 1063 license event with a `title` tag, that
   * title is shown — it's the human-readable label the user typed in the
   * licence modal. Otherwise we fall back to the OS filename.
   * @param {UploadedFileWithLicense} file
   * @returns {string}
   */
  function getDisplayName(file) {
    const title = file.licenseEvent?.tags
      ?.find((/** @type {string[]} */ t) => t[0] === 'title')?.[1]
      ?.trim();
    return title || file.name;
  }

  // ---------------------------------------------------------------------------
  // Upload pipeline
  // ---------------------------------------------------------------------------

  /**
   * Process picked or dropped files one at a time. For each file:
   *   1. Compute its SHA-256 client-side (no bytes leave the browser yet) and
   *      skip it if a file with identical content is already in the list —
   *      duplicate hashes would collide on slot keys and license lookups.
   *   2. Look up any prior kind 1063 attestation, build a pre-upload descriptor.
   *   3. Stash the File against the slot index it will occupy.
   *   4. Open the modal; the modal's beforeAttest hook performs the upload
   *      from `makeBeforeAttest(index)` when the user clicks Save.
   *   5. On modal close, drop the File from the stash and move to the next.
   * @param {FileList | null} fileList
   */
  async function handleFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    if (!activeUser) {
      uploadError = 'Please log in to upload files';
      return;
    }

    uploadError = null;
    isUploading = true;
    uploadProgress = 0;

    const filesToUpload = Array.from(fileList);
    const totalFiles = filesToUpload.length;
    let preparedCount = 0;

    try {
      for (const pickedFile of filesToUpload) {
        // Interactive candidates get normalized into an .xdc before the
        // regular hash/license flow; everything downstream sees the
        // normalized file.
        /** @type {import('$lib/webxdc/interactive-upload.js').PreparedInteractivePackage | null} */
        let prepared = null;
        try {
          prepared = await maybePrepareInteractive(pickedFile);
        } catch (err) {
          console.error('Interactive package processing failed:', err);
          uploadError = m.interactive_input_invalid();
          preparedCount++;
          uploadProgress = Math.round((preparedCount / totalFiles) * 100);
          continue;
        }
        if (prepared?.sizeWarning) interactiveSizeWarning = true;
        const file = prepared?.file ?? pickedFile;

        const cleanerEligible =
          !prepared && runtimeConfig.metadataCleaner?.enabled && isSupportedFile(file);
        // The blocking interstitial is now ONLY the oversized-PDF rescue case:
        // an oversized PDF may still fit after the cleaner's compression, so
        // its size check moves to the resolved file below. Everything else —
        // including normal-sized supported files — skips straight to the
        // license flow, where the quiet metaclean checkbox offers the same
        // cleaning as an opt-in instead of a blocking step.
        const needsInterstitial = cleanerEligible && isPdfFile(file) && file.size > maxSize;
        if (file.size > maxSize && !needsInterstitial) {
          throw new Error(`File "${file.name}" exceeds maximum size of ${formatFileSize(maxSize)}`);
        }

        // Optional metadata review step (metadata-cleaner service). Resolves
        // with the original file when skipped/closed, or the cleaned copy.
        let fileToUpload = file;
        if (needsInterstitial) {
          cleanerFile = file;
          cleanerOpen = true;
          fileToUpload = await new Promise((resolve) => {
            cleanerResolve = resolve;
          });
          cleanerFile = null;
        }

        if (fileToUpload.size > maxSize) {
          throw new Error(
            `File "${fileToUpload.name}" exceeds maximum size of ${formatFileSize(maxSize)}`
          );
        }

        const hash = await sha256Hex(fileToUpload);
        if (files.some((f) => f.sha256 === hash)) {
          uploadError = m.licensed_file_input_duplicate_file({ name: fileToUpload.name });
          preparedCount++;
          uploadProgress = Math.round((preparedCount / totalFiles) * 100);
          continue;
        }
        const existingLicense = await findExistingLicense(hash);
        // A prior license attests the blob already lives on Blossom — reuse its
        // url instead of re-uploading. Re-uploading is wasteful and forces a
        // kind-24242 auth round-trip that 401s/hangs for the accept-existing and
        // create-own flows. Only genuinely new files (no attestation) upload.
        const reuseUrl = getLicenseUrl(existingLicense);
        /** @type {UploadedFileWithLicense} */
        const descriptor = {
          url: reuseUrl ?? '',
          name: fileToUpload.name,
          type: fileToUpload.type || 'application/octet-stream',
          size: fileToUpload.size,
          sha256: hash,
          licenseEvent: null
        };

        const snapshot = files;
        let targetIndex;
        if (multiple) {
          targetIndex = files.length;
          files = [...files, descriptor];
        } else {
          targetIndex = 0;
          files = [descriptor];
        }

        if (prepared) {
          interactiveBySlot.set(targetIndex, prepared);
        } else {
          // single-file mode can replace an interactive slot with a plain file
          interactiveBySlot.delete(targetIndex);
        }
        interactiveIconUrls.delete(targetIndex);

        // Stash the File for deferred upload only when there's no existing blob
        // to reuse. With no stash, the modal's beforeAttest prop stays null and
        // neither Save path uploads.
        if (!reuseUrl) {
          pendingFilesByIndex.set(targetIndex, fileToUpload);
        }

        preparedCount++;
        uploadProgress = Math.round((preparedCount / totalFiles) * 100);

        pendingExistingLicense = existingLicense;
        openModalFor(targetIndex);
        preFileSnapshot = snapshot;
        await new Promise((resolve) => {
          modalCloseListeners.push(resolve);
        });
      }
    } catch (e) {
      uploadError = e instanceof Error ? e.message : 'Upload failed';
      console.error('Upload error:', e);
    } finally {
      isUploading = false;
      uploadProgress = 0;
    }
  }

  /**
   * Returns a beforeAttest callback bound to the given slot index. The modal
   * calls this on Save; it performs the deferred Blossom upload and writes the
   * resulting URL+metadata back into the slot, then returns the values for the
   * modal to use when building the kind 1063 tags.
   * @param {number} index
   */
  function makeBeforeAttest(index) {
    return async () => {
      const file = pendingFilesByIndex.get(index);
      if (!file) throw new Error('makeBeforeAttest: no pending file at index ' + index);
      if (!activeUser?.pubkey) throw new Error('No active user');

      // Quiet clean: only runs when the user opted in via the license
      // modal's checkbox/compression select. Never throws — a failed clean
      // falls back to uploading the original file, noted on the row.
      const prep = interactiveBySlot.get(index);
      let uploadFile = file;
      let cleanedFields = 0;
      let cleanFailed = false;
      if (!prep && (cleanMetadata || cleanCompress !== 'off')) {
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

      const signerFn = async (/** @type {any} */ ev) => {
        if (!activeUser) throw new Error('User not available');
        return await activeUser.signEvent(ev);
      };
      const serverUrl = getActiveBlossomServer(activeUser.pubkey, eventStore);
      const client = new BlossomClient(serverUrl, signerFn);

      // Interactive package: ship the extracted app icon alongside so the
      // kind-1063 discovery event can reference it.
      if (prep?.iconBytes) {
        const iconFile = new File(
          [/** @type {BlobPart} */ (prep.iconBytes)],
          prep.iconMime === 'image/jpeg' ? 'icon.jpg' : 'icon.png',
          { type: prep.iconMime ?? 'image/png' }
        );
        const iconBlob = await client.uploadBlob(iconFile);
        interactiveIconUrls.set(index, reconcileBlobUrlScheme(iconBlob.url, serverUrl));
      }

      const blob = await client.uploadBlob(uploadFile);
      const finalUrl = reconcileBlobUrlScheme(blob.url, serverUrl);

      files = files.map((f, i) =>
        i === index
          ? {
              ...f,
              url: finalUrl,
              sha256: blob.sha256,
              size: blob.size ?? f.size,
              // Interactive slots keep their forced mime — Blossom servers
              // may content-sniff the wrapped package as application/zip,
              // which would strip the m/x tags, player, and shelf downstream.
              type: prep ? 'application/x-webxdc' : blob.type || f.type,
              metaCleanedFields: cleanedFields,
              metaCleanFailed: cleanFailed
            }
          : f
      );

      return {
        url: finalUrl,
        hash: blob.sha256,
        mime: prep
          ? 'application/x-webxdc'
          : blob.type || uploadFile.type || 'application/octet-stream',
        size: blob.size ?? uploadFile.size
      };
    };
  }

  /**
   * Drop `index` from an index-keyed map, shifting higher keys down — keeps
   * per-slot maps aligned with `files` after a removal.
   * @template T
   * @param {SvelteMap<number, T>} map
   * @param {number} index
   */
  function shiftSlotMap(map, index) {
    const entries = [...map].filter(([i]) => i !== index);
    map.clear();
    for (const [i, v] of entries) map.set(i > index ? i - 1 : i, v);
  }

  function removeFile(/** @type {number} */ index) {
    files = files.filter((_, i) => i !== index);
    shiftSlotMap(pendingFilesByIndex, index);
    shiftSlotMap(interactiveBySlot, index);
    shiftSlotMap(interactiveIconUrls, index);
    previewIndex = null;
  }

  function handleRemoveFile(/** @type {number} */ index) {
    return () => removeFile(index);
  }

  function handleAddLicense(/** @type {number} */ index) {
    return () => {
      // Row-button trigger: cancel must NOT mutate files.
      preFileSnapshot = null;
      openModalFor(index);
    };
  }

  /** @param {DragEvent} e */
  function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
  }

  /** @param {DragEvent} e */
  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    isDragging = false;
  }

  /** @param {DragEvent} e */
  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  /** @param {DragEvent} e */
  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    isDragging = false;
    if (disabled || isUploading) return;
    handleFiles(e.dataTransfer?.files ?? null);
  }

  function triggerFileInput() {
    if (!disabled && !isUploading) {
      fileInputRef?.click();
    }
  }

  /** @param {Event} e */
  function handleInputChange(e) {
    const input = /** @type {HTMLInputElement} */ (e.target);
    handleFiles(input.files);
    input.value = '';
  }

  /** @param {KeyboardEvent} e */
  function handleKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      triggerFileInput();
    }
  }

  function clearError() {
    uploadError = null;
  }

  /** @param {Event} e */
  function stopPropagation(e) {
    e.stopPropagation();
  }
</script>

<div class="licensed-file-input form-control w-full">
  {#if label}
    <div class="label">
      <span class="label-text font-medium">{label}</span>
    </div>
  {/if}

  <input
    type="file"
    bind:this={fileInputRef}
    class="hidden"
    {accept}
    {multiple}
    onchange={handleInputChange}
  />

  <!-- Drop zone -->
  <div
    class="cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors {isDragging
      ? 'bg-primary/5'
      : ''}"
    class:border-primary={isDragging}
    class:border-base-300={!isDragging}
    class:hover:border-primary={!disabled && !isUploading}
    class:hover:bg-base-200={!disabled && !isUploading}
    class:opacity-50={disabled}
    class:cursor-not-allowed={disabled}
    role="button"
    tabindex="0"
    ondragenter={handleDragEnter}
    ondragleave={handleDragLeave}
    ondragover={handleDragOver}
    ondrop={handleDrop}
    onclick={triggerFileInput}
    onkeydown={handleKeydown}
  >
    {#if isUploading}
      <div class="flex flex-col items-center gap-3">
        <span class="loading loading-lg loading-spinner text-primary"></span>
        <div class="w-full max-w-xs">
          <progress class="progress w-full progress-primary" value={uploadProgress} max="100"
          ></progress>
        </div>
        <p class="text-sm text-base-content/70">
          {m.blossom_uploading({ progress: String(uploadProgress) })}
        </p>
      </div>
    {:else}
      <div class="flex flex-col items-center gap-2">
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-base-200">
          <PlusIcon class_="w-6 h-6 text-base-content/50" />
        </div>
        <p class="font-medium text-base-content">
          {isDragging ? m.blossom_drop_files() : m.blossom_click_upload()}
        </p>
        <p class="text-sm text-base-content/60">
          {m.blossom_max_size({ size: formatFileSize(maxSize) })}
        </p>
      </div>
    {/if}
  </div>

  {#if uploadError}
    <div class="mt-3 alert py-2 alert-error">
      <span class="text-sm">{uploadError}</span>
      <button type="button" class="btn btn-ghost btn-xs" onclick={clearError}>
        <CloseIcon class_="w-4 h-4" />
      </button>
    </div>
  {/if}

  {#if files.length > 0}
    <div class="mt-3 space-y-2">
      <div class="text-sm font-medium text-base-content/70">
        {m.blossom_uploaded_files({ count: String(files.length) })}
      </div>
      <!-- Index in the key guards against duplicate hashes in legacy/edit-flow data. -->
      {#each files as file, index (`${file.sha256}-${index}`)}
        <div class="flex items-start gap-3 rounded-lg bg-base-200 p-3">
          <span class="shrink-0 text-2xl leading-tight">{getFileIcon(file.type)}</span>
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-2">
              <div class="truncate font-medium text-base-content">{getDisplayName(file)}</div>
              {#if file.type === 'application/x-webxdc'}
                <span class="badge badge-xs badge-primary">{m.interactive_badge()}</span>
              {/if}
            </div>
            <div class="truncate text-xs text-base-content/60">
              {file.type} • {formatFileSize(file.size)}
            </div>
            {#if file.licenseEvent}
              <!-- Render flush with the name/meta: strip the badge's chrome so its
                   text starts at the same left edge instead of being padding-indented. -->
              <div class="mt-1 flex">
                <LicenseBadge
                  licenseEvent={file.licenseEvent}
                  class="!h-auto !border-0 !bg-transparent !px-0"
                />
              </div>
            {/if}
            {#if file.metaCleanedFields}
              <div class="text-xs text-success">
                {m.metaclean_removed_note({ count: String(file.metaCleanedFields) })}
              </div>
            {:else if file.metaCleanFailed}
              <div class="text-xs text-warning">{m.metaclean_clean_failed_note()}</div>
            {/if}
          </div>

          <div class="flex shrink-0 items-center gap-1">
            {#if interactiveBySlot.has(index)}
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                onclick={() => (previewIndex = previewIndex === index ? null : index)}
                disabled={isUploading}
              >
                {m.interactive_input_preview()}
              </button>
            {/if}
            {#if file.licenseEvent}
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                onclick={handleAddLicense(index)}
                disabled={isUploading}
              >
                {m.licensed_image_input_replace_license()}
              </button>
            {:else}
              <button
                type="button"
                class="btn btn-xs btn-warning"
                onclick={handleAddLicense(index)}
                disabled={isUploading}
                data-testid="licensed-file-add-license"
              >
                {m.licensed_file_input_add_license()}
              </button>
            {/if}

            {#if file.url}
              <!-- eslint-disable svelte/no-navigation-without-resolve -- external: blossom file URL -->
              <a
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-ghost btn-xs"
                onclick={stopPropagation}
              >
                {m.blossom_view()}
              </a>
              <!-- eslint-enable svelte/no-navigation-without-resolve -->
            {/if}
            <button
              type="button"
              class="btn text-error btn-ghost btn-xs"
              onclick={handleRemoveFile(index)}
              disabled={isUploading}
              aria-label={m.aria_remove_file()}
            >
              <CloseIcon class_="w-4 h-4" />
            </button>
          </div>
        </div>
        {#if previewIndex === index}
          {@const prep = interactiveBySlot.get(index)}
          {#if prep}
            {#await import('$lib/webxdc/WebxdcPlayer.svelte') then Player}
              <Player.default
                bytes={prep.bytes}
                name={prep.name}
                appKey={`preview:${file.sha256}`}
              />
            {/await}
          {/if}
        {/if}
      {/each}
    </div>
  {/if}

  {#if interactiveSizeWarning}
    <p class="mt-2 text-sm text-warning">{m.interactive_input_too_large()}</p>
  {/if}

  {#if helpText}
    <p class="mt-1 text-xs text-base-content/60">{helpText}</p>
  {/if}
</div>

{#snippet metacleanOptions()}
  <label class="flex cursor-pointer items-start gap-2 text-sm">
    <input
      type="checkbox"
      class="checkbox mt-0.5 checkbox-sm"
      bind:checked={cleanMetadata}
      data-testid="metaclean-license-checkbox"
    />
    <span class="whitespace-normal">{m.metaclean_license_checkbox()}</span>
  </label>
  {#if modalTargetPendingFile && isPdfFile(modalTargetPendingFile)}
    <label class="mt-2 flex items-center gap-2 text-sm">
      <span>{m.metaclean_compress_label()}</span>
      <select
        class="select-bordered select select-xs"
        bind:value={cleanCompress}
        data-testid="metaclean-license-compress"
      >
        <option value="off">{m.metaclean_compress_off()}</option>
        <option value="balanced">{m.metaclean_compress_balanced()}</option>
        <option value="strong">{m.metaclean_compress_strong()}</option>
      </select>
    </label>
  {/if}
  <button
    type="button"
    class="btn mt-1 btn-ghost btn-xs"
    data-testid="metaclean-license-details"
    onclick={() => (inspectOpen = true)}
  >
    {m.metaclean_license_details()}
  </button>
{/snippet}

<LicenseModal
  bind:open={modalOpen}
  hash={modalTargetFile?.sha256 ?? ''}
  url={modalTargetFile?.url ?? ''}
  mime={modalTargetFile?.type ?? ''}
  size={modalTargetFile?.size ?? 0}
  fileName={modalTargetFile?.name ?? ''}
  {activeUserDisplayName}
  existingLicense={pendingExistingLicense}
  initialLicense={interactiveForModal?.licenseUrl ?? null}
  initialCredit={interactiveForModal?.credit ?? null}
  initialTitle={interactiveForModal?.name ?? null}
  initialSource={interactiveForModal?.source ?? null}
  attestExtras={interactiveAttestExtras}
  extraOptions={runtimeConfig.metadataCleaner?.enabled &&
  modalTargetPendingFile &&
  isSupportedFile(modalTargetPendingFile)
    ? metacleanOptions
    : null}
  beforeAttest={modalTargetIndex !== null && pendingFilesByIndex.has(modalTargetIndex)
    ? makeBeforeAttest(modalTargetIndex)
    : null}
  onsave={(/** @type {any} */ license) => {
    if (modalTargetIndex !== null) {
      const idx = modalTargetIndex;
      files = files.map((f, i) => (i === idx ? { ...f, licenseEvent: license } : f));
      pendingFilesByIndex.delete(idx);
    }
    pendingExistingLicense = null;
    preFileSnapshot = null;
    modalTargetIndex = null;
    notifyModalClosed();
  }}
  oncancel={() => {
    // Mandatory case: revert files to the pre-upload snapshot. This handles
    // both single-file replace (restores the previous file) and multi-file
    // append (drops only this latest append). Optional row-button cancel
    // leaves preFileSnapshot null so files stays untouched.
    if (modalTargetIndex !== null) {
      pendingFilesByIndex.delete(modalTargetIndex);
      if (preFileSnapshot !== null) {
        // The appended/replaced slot is being reverted — drop its prepared
        // interactive package so no stale prefill survives.
        interactiveBySlot.delete(modalTargetIndex);
        interactiveIconUrls.delete(modalTargetIndex);
      }
    }
    if (preFileSnapshot !== null) {
      files = preFileSnapshot;
    }
    pendingExistingLicense = null;
    preFileSnapshot = null;
    modalTargetIndex = null;
    notifyModalClosed();
  }}
/>

<MetadataCleanerModal
  bind:open={cleanerOpen}
  file={cleanerFile}
  {maxSize}
  ondone={(/** @type {File} */ f) => {
    cleanerResolve?.(f);
    cleanerResolve = null;
  }}
/>

<MetadataCleanerModal bind:open={inspectOpen} file={modalTargetPendingFile} mode="inspect" />

{#if htmlConfirmOpen}
  <div class="modal-open modal" role="dialog">
    <div class="modal-box max-w-sm">
      <h3 class="text-lg font-bold">{m.interactive_html_confirm_question()}</h3>
      <p class="py-2 text-sm text-base-content/70">{htmlConfirmName}</p>
      <div class="modal-action">
        <button type="button" class="btn btn-sm" onclick={() => answerHtmlConfirm(false)}>
          {m.interactive_html_confirm_no()}
        </button>
        <button
          type="button"
          class="btn btn-sm btn-primary"
          onclick={() => answerHtmlConfirm(true)}
        >
          {m.interactive_html_confirm_yes()}
        </button>
      </div>
    </div>
  </div>
{/if}
