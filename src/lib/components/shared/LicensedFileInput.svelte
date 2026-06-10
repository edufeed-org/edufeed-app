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

  const modalTargetFile = $derived(modalTargetIndex !== null ? files[modalTargetIndex] : null);

  // Callbacks that resolve the Promise the upload loop is awaiting. Cleared on
  // every notifyModalClosed() — guarantees a fresh listener per upload, no leaks.
  /** @type {Array<(value?: unknown) => void>} */
  let modalCloseListeners = [];

  function notifyModalClosed() {
    const listeners = modalCloseListeners;
    modalCloseListeners = [];
    for (const l of listeners) l();
  }

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
  // File icon + size helpers (copied verbatim from BlossomUploader.svelte)
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

  // ---------------------------------------------------------------------------
  // Upload pipeline
  // ---------------------------------------------------------------------------

  /**
   * Upload a single file via Blossom.
   * @param {File} file
   * @returns {Promise<UploadedFileWithLicense>}
   */
  async function uploadFile(file) {
    if (file.size > maxSize) {
      throw new Error(`File "${file.name}" exceeds maximum size of ${formatFileSize(maxSize)}`);
    }
    if (!activeUser?.signer) {
      throw new Error('No signer available. Please log in.');
    }
    const signerFn = async (/** @type {any} */ ev) => {
      if (!activeUser) throw new Error('User not available');
      return await activeUser.signEvent(ev);
    };
    const serverUrl = getActiveBlossomServer(activeUser.pubkey, eventStore);
    const client = new BlossomClient(serverUrl, signerFn);
    const blob = await client.uploadBlob(file);
    return {
      url: blob.url,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      sha256: blob.sha256,
      licenseEvent: null
    };
  }

  /**
   * Handle a FileList from input or drop. Uploads each file in turn and opens
   * the license modal for each — awaiting close before processing the next.
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
    let uploadedCount = 0;

    try {
      for (const file of filesToUpload) {
        const uploaded = await uploadFile(file);

        // Determine the index this file will occupy *after* the append.
        let targetIndex;
        if (multiple) {
          targetIndex = files.length;
          files = [...files, uploaded];
        } else {
          targetIndex = 0;
          files = [uploaded];
        }

        uploadedCount++;
        uploadProgress = Math.round((uploadedCount / totalFiles) * 100);

        // Network check: skip the modal if a kind 1063 event for this hash
        // already exists from any user. findExistingLicense added it to EventStore
        // already, so the reactive $effect would pick it up — but we also assign
        // directly so the row UI updates immediately in this tick.
        const existing = uploaded.sha256 ? await findExistingLicense(uploaded.sha256) : null;
        if (existing) {
          const idx = targetIndex;
          files = files.map((item, i) => (i === idx ? { ...item, licenseEvent: existing } : item));
        } else {
          openModalFor(targetIndex);
          await new Promise((resolve) => {
            modalCloseListeners.push(resolve);
          });
        }
      }
    } catch (e) {
      uploadError = e instanceof Error ? e.message : 'Upload failed';
      console.error('Upload error:', e);
    } finally {
      isUploading = false;
      uploadProgress = 0;
    }
  }

  function removeFile(/** @type {number} */ index) {
    files = files.filter((_, i) => i !== index);
  }

  function handleRemoveFile(/** @type {number} */ index) {
    return () => removeFile(index);
  }

  function handleAddLicense(/** @type {number} */ index) {
    return () => openModalFor(index);
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
      {#each files as file, index (file.url)}
        <div class="flex flex-wrap items-center gap-3 rounded-lg bg-base-200 p-3">
          <span class="text-2xl">{getFileIcon(file.type)}</span>
          <div class="min-w-0 flex-1">
            <div class="truncate font-medium text-base-content">{file.name}</div>
            <div class="text-xs text-base-content/60">
              {file.type} • {formatFileSize(file.size)}
            </div>
          </div>

          {#if file.licenseEvent}
            <LicenseBadge licenseEvent={file.licenseEvent} />
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
  {activeUserDisplayName}
  onsave={(/** @type {any} */ license) => {
    if (modalTargetIndex !== null) {
      const idx = modalTargetIndex;
      files = files.map((f, i) => (i === idx ? { ...f, licenseEvent: license } : f));
    }
    modalTargetIndex = null;
    notifyModalClosed();
  }}
  oncancel={() => {
    // Mandatory mode — cancel removes the un-licensed file row entirely.
    if (modalTargetIndex !== null) {
      const idx = modalTargetIndex;
      files = files.filter((_, i) => i !== idx);
    }
    modalTargetIndex = null;
    notifyModalClosed();
  }}
/>
