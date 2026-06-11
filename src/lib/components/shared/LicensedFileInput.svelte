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
  import { findExistingLicense } from '$lib/helpers/image-license.js';
  import { reconcileBlobUrlScheme } from '$lib/helpers/blossom-trust.js';
  import { sha256Hex } from '$lib/helpers/sha256.js';
  import { SvelteMap } from 'svelte/reactivity';
  import LicenseBadge from './LicenseBadge.svelte';
  import LicenseModal from './LicenseModal.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} UploadedFileWithLicense
   * @property {string} url
   * @property {string} name
   * @property {string} type
   * @property {number} size
   * @property {string} [sha256]
   * @property {any} [licenseEvent]
   */

  /** @type {{ files?: UploadedFileWithLicense[], multiple?: boolean, accept?: string, maxSize?: number, label?: string, helpText?: string, disabled?: boolean, activeUserDisplayName?: string }} */
  let {
    files = $bindable([]),
    multiple = true,
    accept = '*/*',
    maxSize = runtimeConfig.blossom.maxFileSize,
    label = '',
    helpText = '',
    disabled = false,
    activeUserDisplayName = ''
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
      for (const file of filesToUpload) {
        if (file.size > maxSize) {
          throw new Error(`File "${file.name}" exceeds maximum size of ${formatFileSize(maxSize)}`);
        }
        const hash = await sha256Hex(file);
        if (files.some((f) => f.sha256 === hash)) {
          uploadError = m.licensed_file_input_duplicate_file({ name: file.name });
          preparedCount++;
          uploadProgress = Math.round((preparedCount / totalFiles) * 100);
          continue;
        }
        const existingLicense = await findExistingLicense(hash);
        /** @type {UploadedFileWithLicense} */
        const descriptor = {
          url: '',
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
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

        pendingFilesByIndex.set(targetIndex, file);

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

      const signerFn = async (/** @type {any} */ ev) => {
        if (!activeUser) throw new Error('User not available');
        return await activeUser.signEvent(ev);
      };
      const serverUrl = getActiveBlossomServer(activeUser.pubkey, eventStore);
      const client = new BlossomClient(serverUrl, signerFn);
      const blob = await client.uploadBlob(file);
      const finalUrl = reconcileBlobUrlScheme(blob.url, serverUrl);

      files = files.map((f, i) =>
        i === index
          ? {
              ...f,
              url: finalUrl,
              sha256: blob.sha256,
              size: blob.size ?? f.size,
              type: blob.type || f.type
            }
          : f
      );

      return {
        url: finalUrl,
        hash: blob.sha256,
        mime: blob.type || file.type || 'application/octet-stream',
        size: blob.size ?? file.size
      };
    };
  }

  function removeFile(/** @type {number} */ index) {
    files = files.filter((_, i) => i !== index);
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
            <div class="truncate font-medium text-base-content">{getDisplayName(file)}</div>
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
          </div>

          <div class="flex shrink-0 items-center gap-1">
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
      {/each}
    </div>
  {/if}

  {#if helpText}
    <p class="mt-1 text-xs text-base-content/60">{helpText}</p>
  {/if}
</div>

<LicenseModal
  bind:open={modalOpen}
  hash={modalTargetFile?.sha256 ?? ''}
  url={modalTargetFile?.url ?? ''}
  mime={modalTargetFile?.type ?? ''}
  size={modalTargetFile?.size ?? 0}
  fileName={modalTargetFile?.name ?? ''}
  {activeUserDisplayName}
  existingLicense={pendingExistingLicense}
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
