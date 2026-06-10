<script>
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import CameraIcon from '$lib/components/icons/actions/CameraIcon.svelte';
  import * as m from '$lib/paraglide/messages';
  import { uploadAndFindLicense } from '$lib/helpers/upload-and-find-license.js';
  import LicenseModal from './LicenseModal.svelte';

  let { userData = $bindable(), signer = null, errors = $bindable({}) } = $props();

  let uploading = $state(false);
  /** @type {string | null} */
  let preview = $state(null);
  /** @type {HTMLInputElement | null} */
  let fileInputRef = $state(null);

  // Pending upload awaiting license modal
  let pendingUrl = $state('');
  let pendingHash = $state('');
  let pendingMime = $state('');
  let pendingSize = $state(0);
  /** @type {any} */
  let pendingExistingLicense = $state(null);
  let modalOpen = $state(false);
  let previousBanner = $state('');

  const activeUserDisplayName = $derived(
    (userData.display_name && userData.display_name.trim()) ||
      (userData.name && userData.name.trim()) ||
      ''
  );

  async function handleFileSelected(/** @type {Event} */ event) {
    const target = /** @type {HTMLInputElement} */ (event.target);
    const file = target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      errors.banner = m.banner_uploader_error_invalid_file();
      return;
    }
    if (file.size > runtimeConfig.blossom.maxFileSize) {
      errors.banner = m.banner_uploader_error_too_large({
        size: Math.round(runtimeConfig.blossom.maxFileSize / (1024 * 1024))
      });
      return;
    }
    if (!signer) {
      errors.banner = m.banner_uploader_error_no_signer();
      return;
    }

    try {
      uploading = true;
      errors.banner = '';

      const reader = new FileReader();
      reader.onload = (e) => {
        const r = e.target?.result;
        preview = typeof r === 'string' ? r : null;
      };
      reader.readAsDataURL(file);

      const result = await uploadAndFindLicense(file, { signer });

      // Always open the modal for explicit consent. If an existing license
      // is found, LicenseModal shows the Accept / Create-my-own view.
      previousBanner = userData.banner || '';
      pendingUrl = result.url;
      pendingHash = result.sha256;
      pendingMime = result.type;
      pendingSize = result.size;
      pendingExistingLicense = result.existingLicense;
      modalOpen = true;
    } catch (e) {
      console.error('Banner upload failed:', e);
      errors.banner = m.banner_uploader_error_upload_failed();
      preview = null;
      pendingExistingLicense = null;
    } finally {
      uploading = false;
      if (fileInputRef) fileInputRef.value = '';
    }
  }

  function triggerUpload() {
    fileInputRef?.click();
  }
</script>

<div class="form-control">
  <label class="label" for="banner-upload-input">
    <span class="label-text">{m.banner_uploader_label()}</span>
  </label>

  <div class="space-y-2">
    <div
      class="relative aspect-[3/1] w-full overflow-hidden rounded-lg border-2 border-dashed border-base-300 bg-base-200"
    >
      {#if uploading}
        <div class="flex h-full w-full items-center justify-center">
          <span class="loading loading-lg loading-spinner"></span>
        </div>
      {:else if userData.banner || pendingUrl || preview}
        <img
          src={userData.banner || pendingUrl || preview}
          alt="Banner"
          class="h-full w-full object-cover"
        />
      {:else}
        <button
          type="button"
          onclick={triggerUpload}
          class="flex h-full w-full flex-col items-center justify-center text-base-content/50 hover:text-base-content"
        >
          <CameraIcon class="h-8 w-8" />
          <span class="mt-2 text-sm">{m.banner_uploader_drop_or_click()}</span>
        </button>
      {/if}

      {#if userData.banner || pendingUrl || preview}
        <button
          type="button"
          onclick={triggerUpload}
          disabled={uploading}
          class="btn absolute right-2 bottom-2 btn-sm btn-primary"
        >
          <CameraIcon class="h-4 w-4" />
          {m.banner_uploader_replace_button()}
        </button>
      {/if}
    </div>

    <input
      id="banner-upload-input"
      bind:this={fileInputRef}
      type="file"
      accept="image/*"
      class="hidden"
      onchange={handleFileSelected}
      disabled={uploading}
    />

    <input
      type="url"
      class="input-bordered input w-full"
      placeholder={m.banner_uploader_url_placeholder()}
      bind:value={userData.banner}
    />

    <p class="text-xs opacity-70">
      {m.banner_uploader_help_text()}
      ·
      {m.banner_uploader_max_size({
        size: Math.round(runtimeConfig.blossom.maxFileSize / (1024 * 1024))
      })}
    </p>
  </div>

  {#if errors.banner}
    <div class="label" aria-live="polite">
      <span class="label-text-alt text-error">{errors.banner}</span>
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
    userData.banner = pendingUrl;
    pendingUrl = '';
    pendingHash = '';
    pendingExistingLicense = null;
  }}
  oncancel={() => {
    userData.banner = previousBanner;
    pendingUrl = '';
    pendingHash = '';
    pendingExistingLicense = null;
    preview = null;
  }}
/>
