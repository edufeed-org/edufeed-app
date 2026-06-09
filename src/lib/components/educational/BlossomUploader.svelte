<!--
  BlossomUploader Component
  File upload component for blossom server with drag-and-drop support
-->

<script>
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { CloseIcon, PlusIcon } from '$lib/components/icons';
  import { BlossomClient } from 'blossom-client-sdk';
  import { getActiveBlossomServer } from '$lib/services/blossom-settings-service.js';
  import { createBlossomServerLoader } from '$lib/loaders/blossom-server-loader.js';
  import { getRelayListLookupRelays } from '$lib/services/relay-service.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} UploadedFile
   * @property {string} url - The blossom URL of the uploaded file
   * @property {string} name - Original filename
   * @property {string} type - MIME type
   * @property {number} size - File size in bytes
   * @property {string} [sha256] - SHA256 hash if available
   * @property {any} [licenseEvent] - License event (kind 1063) when attested
   */

  /** @type {{ files?: UploadedFile[], multiple?: boolean, accept?: string, maxSize?: number, label?: string, helpText?: string, disabled?: boolean, required?: boolean, onchange?: (files: UploadedFile[]) => void }} */
  let {
    files = $bindable([]),
    multiple = true,
    accept = '*/*',
    maxSize = runtimeConfig.blossom.maxFileSize,
    label = '',
    helpText = '',
    disabled = false,
    required = false,
    onchange = () => {}
  } = $props();

  // State
  let isDragging = $state(false);
  let isUploading = $state(false);
  let uploadProgress = $state(0);
  let error = $state(/** @type {string | null} */ (null));
  let fileInputRef = $state(/** @type {HTMLInputElement | null} */ (null));

  // Get active user for signing
  let activeUser = $state(manager.active);
  $effect(() => {
    const subscription = manager.active$.subscribe((user) => {
      activeUser = user;
    });
    return () => subscription.unsubscribe();
  });

  // Load user's blossom server list (kind 10063) so getActiveBlossomServer() can find it
  $effect(() => {
    if (!activeUser?.pubkey) return;

    const lookupRelays = getRelayListLookupRelays();
    const loader = createBlossomServerLoader(pool, lookupRelays, eventStore, activeUser.pubkey);
    const subscription = loader()().subscribe();

    return () => subscription?.unsubscribe();
  });

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
   * Upload a single file to blossom using the SDK
   * @param {File} file
   * @returns {Promise<UploadedFile>}
   */
  async function uploadFile(file) {
    // Validate file size
    if (file.size > maxSize) {
      throw new Error(`File "${file.name}" exceeds maximum size of ${formatFileSize(maxSize)}`);
    }

    if (!activeUser?.signer) {
      throw new Error('No signer available. Please log in.');
    }

    // Create a signer function compatible with blossom-client-sdk
    const signer = async (/** @type {any} */ event) => {
      if (!activeUser) throw new Error('User not available');
      return await activeUser.signEvent(event);
    };

    // Get the blossom server (user's preference or default)
    const serverUrl = getActiveBlossomServer(activeUser.pubkey, eventStore);

    // Create Blossom client
    const client = new BlossomClient(serverUrl, signer);

    // Upload file using the SDK
    const blob = await client.uploadBlob(file);

    return {
      url: blob.url,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      sha256: blob.sha256
    };
  }

  /**
   * Handle file selection from input or drop
   * @param {FileList | null} fileList
   */
  async function handleFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    if (!activeUser) {
      error = 'Please log in to upload files';
      return;
    }

    error = null;
    isUploading = true;
    uploadProgress = 0;

    const filesToUpload = Array.from(fileList);
    const totalFiles = filesToUpload.length;
    let uploadedCount = 0;

    try {
      for (const file of filesToUpload) {
        const uploaded = await uploadFile(file);

        if (multiple) {
          files = [...files, uploaded];
        } else {
          files = [uploaded];
        }

        uploadedCount++;
        uploadProgress = Math.round((uploadedCount / totalFiles) * 100);
      }

      onchange(files);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Upload failed';
      console.error('Upload error:', e);
    } finally {
      isUploading = false;
      uploadProgress = 0;
    }
  }

  /**
   * Remove an uploaded file
   * @param {number} index
   */
  function removeFile(index) {
    files = files.filter((_, i) => i !== index);
    onchange(files);
  }

  /**
   * Handle drag events
   * @param {DragEvent} e
   */
  function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
  }

  /**
   * @param {DragEvent} e
   */
  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    isDragging = false;
  }

  /**
   * @param {DragEvent} e
   */
  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  /**
   * @param {DragEvent} e
   */
  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    isDragging = false;

    if (disabled || isUploading) return;
    handleFiles(e.dataTransfer?.files ?? null);
  }

  /**
   * Trigger file input click
   */
  function triggerFileInput() {
    if (!disabled && !isUploading) {
      fileInputRef?.click();
    }
  }

  /**
   * Handle file input change
   * @param {Event} e
   */
  function handleInputChange(e) {
    const input = /** @type {HTMLInputElement} */ (e.target);
    handleFiles(input.files);
    // Reset input so same file can be selected again
    input.value = '';
  }

  /**
   * Handle keyboard events for accessibility
   * @param {KeyboardEvent} e
   */
  function handleKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      triggerFileInput();
    }
  }

  /**
   * Clear error message
   */
  function clearError() {
    error = null;
  }

  /**
   * Handle remove file click
   * @param {number} index
   */
  function handleRemoveFile(index) {
    return () => removeFile(index);
  }

  /**
   * Prevent propagation
   * @param {Event} e
   */
  function stopPropagation(e) {
    e.stopPropagation();
  }
</script>

<div class="blossom-uploader form-control w-full">
  <!-- Label -->
  {#if label || m.blossom_upload_label()}
    <div class="label">
      <span class="label-text font-medium">
        {label || m.blossom_upload_label()}
        {#if required}
          <span class="text-error">*</span>
        {/if}
      </span>
    </div>
  {/if}

  <!-- Hidden file input -->
  <input
    type="file"
    bind:this={fileInputRef}
    class="hidden"
    {accept}
    {multiple}
    onchange={handleInputChange}
  />

  <!-- Drop Zone -->
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
      <!-- Upload Progress -->
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
      <!-- Upload Prompt -->
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

  <!-- Error Message -->
  {#if error}
    <div class="mt-3 alert py-2 alert-error">
      <span class="text-sm">{error}</span>
      <button class="btn btn-ghost btn-xs" onclick={clearError}>
        <CloseIcon class_="w-4 h-4" />
      </button>
    </div>
  {/if}

  <!-- Uploaded Files List -->
  {#if files.length > 0}
    <div class="mt-3 space-y-2">
      <div class="text-sm font-medium text-base-content/70">
        {m.blossom_uploaded_files({ count: String(files.length) })}
      </div>
      {#each files as file, index (file.url)}
        <div class="flex items-center gap-3 rounded-lg bg-base-200 p-3">
          <span class="text-2xl">{getFileIcon(file.type)}</span>
          <div class="min-w-0 flex-1">
            <div class="truncate font-medium text-base-content">{file.name}</div>
            <div class="text-xs text-base-content/60">
              {file.type} • {formatFileSize(file.size)}
            </div>
          </div>
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
            aria-label={m.aria_remove_file()}
          >
            <CloseIcon class_="w-4 h-4" />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Help Text -->
  {#if helpText}
    <p class="mt-1 text-xs text-base-content/60">{helpText}</p>
  {/if}
</div>
