<script>
  import { BlossomClient } from 'blossom-client-sdk';
  import { getSha256FromURL } from 'applesauce-common/helpers';
  import * as m from '$lib/paraglide/messages';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { getActiveBlossomServer } from '$lib/services/blossom-settings-service.js';
  import { useLicenseForHash } from '$lib/stores/image-license.svelte.js';
  import { findExistingLicense } from '$lib/helpers/image-license.js';
  import LicenseBadge from './LicenseBadge.svelte';
  import LicenseModal from './LicenseModal.svelte';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';

  let {
    imageUrl = $bindable(''),
    imageWasUploaded = $bindable(false),
    licenseEvent = $bindable(null),
    errors = {},
    activeUserDisplayName = ''
  } = $props();

  // Hash currently associated with imageUrl (from upload or paste-of-Blossom).
  let currentHash = $state(/** @type {string | null} */ (null));
  let uploading = $state(false);
  let modalOpen = $state(false);

  // MIME / size of last-uploaded blob — passed through to LicenseModal.
  let modalSize = $state(/** @type {number | undefined} */ (undefined));
  let modalMime = $state('image/jpeg');

  // Upload-side ephemeral error (invalid file type, too large, upload failed).
  // Kept separate from `errors` prop which is owned by the wizard's $derived validator.
  let uploadError = $state('');

  // Reactive license event from EventStore.
  const getLicense = useLicenseForHash(() => currentHash);
  $effect(() => {
    licenseEvent = getLicense();
  });

  /** @type {HTMLInputElement | null} */
  let fileInputRef = null;

  function triggerUpload() {
    fileInputRef?.click();
  }

  /**
   * @param {Event} ev
   */
  async function handleFileSelected(ev) {
    const target = /** @type {HTMLInputElement} */ (ev.target);
    const file = target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      uploadError = m.licensed_image_input_error_invalid_file();
      return;
    }
    const maxBytes = runtimeConfig.blossom?.maxFileSize ?? 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      uploadError = m.licensed_image_input_error_too_large({
        size: Math.round(maxBytes / (1024 * 1024))
      });
      return;
    }

    uploading = true;
    uploadError = '';
    try {
      const signer = manager.active;
      if (!signer) throw new Error('No active account');
      const signerFn = async (/** @type {any} */ template) => signer.signEvent(template);
      const serverUrl = getActiveBlossomServer(signer.pubkey || '', eventStore);
      const client = new BlossomClient(serverUrl, signerFn);
      const blob = await client.uploadBlob(file);

      imageUrl = blob.url;
      currentHash = blob.sha256;
      modalMime = blob.type || file.type;
      modalSize = blob.size ?? file.size;
      imageWasUploaded = true;

      // Network check: is there already a kind 1063 license event for this
      // hash from another user? If so, bind it reactively (the helper added it
      // to EventStore so useLicenseForHash will resolve it) and skip the modal.
      const existing = await findExistingLicense(blob.sha256);
      if (!existing && !getLicense()) {
        modalOpen = true;
      }
    } catch (e) {
      console.error('Image upload failed', e);
      uploadError = m.licensed_image_input_error_upload_failed();
    } finally {
      uploading = false;
      if (fileInputRef) fileInputRef.value = '';
    }
  }

  function handleUrlBlur() {
    if (!imageUrl) {
      currentHash = null;
      imageWasUploaded = false;
      return;
    }
    const hashFromUrl = getSha256FromURL(imageUrl);
    currentHash = hashFromUrl ?? null;
    imageWasUploaded = false;
  }
</script>

<div class="form-control">
  <div class="flex items-stretch gap-2">
    <input
      data-testid="licensed-image-url-input"
      type="url"
      class="input-bordered input flex-1"
      placeholder={m.licensed_image_input_url_placeholder()}
      bind:value={imageUrl}
      onblur={handleUrlBlur}
    />
    <button type="button" class="btn btn-secondary" onclick={triggerUpload} disabled={uploading}>
      {#if uploading}
        <span class="loading loading-sm loading-spinner"></span>
        {m.licensed_image_input_uploading()}
      {:else}
        {m.licensed_image_input_upload_button()}
      {/if}
    </button>
    <input
      data-testid="licensed-image-file-input"
      bind:this={fileInputRef}
      type="file"
      accept="image/*"
      class="hidden"
      onchange={handleFileSelected}
    />
  </div>

  {#if licenseEvent}
    <div class="mt-2 flex items-center gap-2 text-xs">
      <LicenseBadge {licenseEvent} />
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        onclick={() => {
          modalOpen = true;
        }}
      >
        {m.licensed_image_input_replace_license()}
      </button>
    </div>
  {/if}

  {#if uploadError || errors.image}
    <p class="mt-1 text-xs text-error">{uploadError || errors.image}</p>
  {/if}
</div>

<LicenseModal
  bind:open={modalOpen}
  hash={currentHash || ''}
  url={imageUrl}
  mime={modalMime}
  size={modalSize ?? 0}
  {activeUserDisplayName}
  onsave={(/** @type {any} */ license) => {
    licenseEvent = license;
  }}
  oncancel={() => {
    // Mandatory mode: cancel discards the upload entirely.
    imageUrl = '';
    currentHash = null;
    imageWasUploaded = false;
    licenseEvent = null;
  }}
/>
