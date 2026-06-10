<script>
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import CameraIcon from '$lib/components/icons/actions/CameraIcon.svelte';
  import * as m from '$lib/paraglide/messages';
  import { uploadAndFindLicense } from '$lib/helpers/upload-and-find-license.js';
  import LicenseModal from './LicenseModal.svelte';

  let { userData = $bindable(), signer = null, errors = $bindable({}) } = $props();

  // UI state
  let uploadingImage = $state(false);
  let imagePreview = $state(/** @type {string | null} */ (null));
  let fileInputRef = $state(/** @type {HTMLInputElement | null} */ (null));

  // Pending upload awaiting license modal
  let pendingUrl = $state('');
  let pendingHash = $state('');
  let pendingMime = $state('');
  let pendingSize = $state(0);
  /** @type {any} */
  let pendingExistingLicense = $state(null);
  let modalOpen = $state(false);
  let previousPicture = $state('');

  const activeUserDisplayName = $derived(
    (userData.display_name && userData.display_name.trim()) ||
      (userData.name && userData.name.trim()) ||
      ''
  );

  /**
   * Handle image file selection
   * @param {Event} event
   */
  async function handleImageUpload(event) {
    const target = /** @type {HTMLInputElement} */ (event.target);
    const file = target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      errors.image = m.avatar_uploader_error_invalid_file();
      return;
    }

    // Validate file size
    if (file.size > runtimeConfig.blossom.maxFileSize) {
      errors.image = m.avatar_uploader_error_too_large({
        size: Math.round(runtimeConfig.blossom.maxFileSize / (1024 * 1024))
      });
      return;
    }

    if (!signer) {
      errors.image = m.avatar_uploader_error_no_signer();
      return;
    }

    try {
      uploadingImage = true;
      errors.image = '';

      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result;
        imagePreview = typeof result === 'string' ? result : null;
      };
      reader.readAsDataURL(file);

      const result = await uploadAndFindLicense(file, { signer });

      // Always open the modal. If an existing license is found, LicenseModal
      // shows it in "Accept / Create my own" mode; if not, the standard form.
      // DO NOT bind userData.picture yet — wait for modal save.
      previousPicture = userData.picture || '';
      pendingUrl = result.url;
      pendingHash = result.sha256;
      pendingMime = result.type;
      pendingSize = result.size;
      pendingExistingLicense = result.existingLicense;
      modalOpen = true;
    } catch (error) {
      console.error('Image upload failed:', error);
      errors.image = m.avatar_uploader_error_upload_failed();
      imagePreview = null;
      pendingExistingLicense = null;
    } finally {
      uploadingImage = false;
    }
  }

  /**
   * Trigger file input click
   */
  function triggerUpload() {
    fileInputRef?.click();
  }
</script>

<div class="form-control">
  <label class="label" for="avatar-upload-input">
    <span class="label-text">{m.avatar_uploader_label()}</span>
  </label>

  <!-- Avatar Upload Container -->
  <div class="flex flex-col items-center gap-4">
    <!-- Circular Avatar with Upload Button -->
    <div class="relative">
      <!-- Avatar Circle -->
      <div
        class="h-32 w-32 overflow-hidden rounded-full border-4 border-base-200 bg-base-300 shadow-lg"
      >
        {#if uploadingImage}
          <!-- Loading State -->
          <div class="flex h-full w-full flex-col items-center justify-center bg-base-300/90">
            <span class="loading loading-lg loading-spinner"></span>
            <span class="mt-2 text-xs opacity-70">{m.avatar_uploader_uploading()}</span>
          </div>
        {:else if userData.picture || pendingUrl || imagePreview}
          <!-- Image Preview -->
          <img
            src={userData.picture || pendingUrl || imagePreview}
            alt="Profile"
            class="h-full w-full object-cover"
          />
        {:else}
          <!-- Empty State Placeholder -->
          <div class="flex h-full w-full items-center justify-center text-base-content/30">
            <svg class="h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          </div>
        {/if}
      </div>

      <!-- Upload Button (Bottom-Right) -->
      <button
        type="button"
        onclick={triggerUpload}
        disabled={uploadingImage}
        class="btn absolute right-0 bottom-0 btn-circle shadow-lg transition-transform btn-sm btn-primary hover:scale-110"
        class:opacity-50={uploadingImage}
      >
        <CameraIcon class="h-4 w-4" />
      </button>
    </div>

    <!-- Hidden File Input -->
    <input
      id="avatar-upload-input"
      bind:this={fileInputRef}
      type="file"
      accept="image/*"
      class="hidden"
      onchange={handleImageUpload}
      disabled={uploadingImage}
    />

    <!-- Helper Text -->
    <div class="text-center">
      <p class="text-xs opacity-70">
        {m.avatar_uploader_help_text()}
      </p>
      <p class="text-xs opacity-70">
        {m.avatar_uploader_max_size({
          size: Math.round(runtimeConfig.blossom.maxFileSize / (1024 * 1024))
        })}
      </p>
    </div>
  </div>

  <!-- Error Message -->
  {#if errors.image}
    <div class="label" aria-live="polite">
      <span class="label-text-alt text-error">{errors.image}</span>
    </div>
  {/if}
</div>

<LicenseModal
  bind:open={modalOpen}
  hash={pendingHash}
  url={pendingUrl}
  mime={pendingMime}
  size={pendingSize}
  {activeUserDisplayName}
  defaultSelfCreator={true}
  existingLicense={pendingExistingLicense}
  onsave={() => {
    userData.picture = pendingUrl;
    pendingUrl = '';
    pendingHash = '';
    pendingExistingLicense = null;
  }}
  oncancel={() => {
    userData.picture = previousPicture;
    pendingUrl = '';
    pendingHash = '';
    pendingExistingLicense = null;
    imagePreview = null;
  }}
/>
