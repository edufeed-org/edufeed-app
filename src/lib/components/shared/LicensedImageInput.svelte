<script>
  import { BlossomClient } from 'blossom-client-sdk';
  import { getSha256FromURL } from 'applesauce-common/helpers';
  import * as m from '$lib/paraglide/messages';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { getActiveBlossomServer } from '$lib/services/blossom-settings-service.js';
  import { useLicenseForHash } from '$lib/stores/image-license.svelte.js';
  import { findExistingLicense } from '$lib/helpers/image-license.js';
  import { reconcileBlobUrlScheme } from '$lib/helpers/blossom-trust.js';
  import { sha256Hex } from '$lib/helpers/sha256.js';
  import LicenseBadge from './LicenseBadge.svelte';
  import LicenseModal from './LicenseModal.svelte';
  import ImageSourceChooserModal from './ImageSourceChooserModal.svelte';
  import ImageLibraryPickerModal from './ImageLibraryPickerModal.svelte';
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
  let chooserOpen = $state(false);
  let libraryOpen = $state(false);

  /** @type {any} */
  let pendingExistingLicense = $state(null);
  // MIME / size of last-uploaded blob — passed through to LicenseModal.
  let modalSize = $state(/** @type {number | undefined} */ (undefined));
  let modalMime = $state('image/jpeg');

  // Upload-side ephemeral error (invalid file type, too large, upload failed).
  // Kept separate from `errors` prop which is owned by the wizard's $derived validator.
  let uploadError = $state('');

  /** @type {File | null} */
  let pendingFile = $state(null);
  let pickToken = 0;

  // Reactive license event from EventStore.
  const getLicense = useLicenseForHash(() => currentHash);
  $effect(() => {
    licenseEvent = getLicense();
  });

  /** @type {HTMLInputElement | null} */
  let fileInputRef = null;

  function handleAddImage() {
    chooserOpen = true;
  }

  /**
   * @param {{ url: string, hash: string, licenseEvent: any }} picked
   */
  function handleLibraryPick(picked) {
    imageUrl = picked.url;
    currentHash = picked.hash;
    // library-picked images already carry a licenseEvent; skip the upload gate
    imageWasUploaded = false;
    // Add to EventStore so the reactive useLicenseForHash ($effect) resolves
    // licenseEvent for us — avoids a race with the imperative write.
    // EventStore.add is idempotent: duplicates return the existing event without throwing.
    eventStore.add(picked.licenseEvent);
  }

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

    uploadError = '';
    const myToken = ++pickToken;
    uploading = true;

    try {
      const hash = await sha256Hex(file);
      if (myToken !== pickToken) return; // a newer pick superseded us

      pendingFile = file;
      currentHash = hash;
      modalMime = file.type;
      modalSize = file.size;

      pendingExistingLicense = await findExistingLicense(hash);
      if (myToken !== pickToken) return;

      modalOpen = true;
    } catch (e) {
      console.error('File preparation failed', e);
      uploadError = m.licensed_image_input_error_upload_failed();
      pendingFile = null;
    } finally {
      if (fileInputRef) fileInputRef.value = '';
      uploading = false;
    }
  }

  /**
   * Upload the stashed pendingFile to Blossom. Called from the LicenseModal's
   * beforeAttest hook, so it runs only after the user has filled out the
   * licence form and ticked the disclosure.
   * @returns {Promise<{ url: string, hash: string, mime: string, size: number }>}
   */
  async function performUpload() {
    if (!pendingFile) {
      throw new Error('performUpload: no pendingFile');
    }
    const signer = manager.active;
    if (!signer) throw new Error('No active account');
    const signerFn = async (/** @type {any} */ template) => signer.signEvent(template);
    const serverUrl = getActiveBlossomServer(signer.pubkey || '', eventStore);
    const client = new BlossomClient(serverUrl, signerFn);
    const blob = await client.uploadBlob(pendingFile);

    const finalUrl = reconcileBlobUrlScheme(blob.url, serverUrl);
    imageUrl = finalUrl;
    imageWasUploaded = true;
    currentHash = blob.sha256;
    return {
      url: finalUrl,
      hash: blob.sha256,
      mime: blob.type || pendingFile.type,
      size: blob.size ?? pendingFile.size
    };
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
    <button
      type="button"
      class="btn btn-secondary"
      onclick={handleAddImage}
      disabled={uploading}
      data-testid="licensed-image-add-button"
    >
      {#if uploading}
        <span class="loading loading-sm loading-spinner"></span>
        {m.licensed_image_input_uploading()}
      {:else}
        {m.licensed_image_input_add_button()}
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
  existingLicense={pendingExistingLicense}
  beforeAttest={pendingFile ? performUpload : null}
  onsave={(/** @type {any} */ license) => {
    licenseEvent = license;
    pendingExistingLicense = null;
    pendingFile = null;
  }}
  oncancel={() => {
    // Cancel discards the pending upload entirely. No bytes have been
    // sent to Blossom yet (performUpload runs only from beforeAttest),
    // so there is no orphan to clean up.
    imageUrl = '';
    currentHash = null;
    imageWasUploaded = false;
    licenseEvent = null;
    pendingExistingLicense = null;
    pendingFile = null;
  }}
/>

<ImageSourceChooserModal
  bind:open={chooserOpen}
  onupload={triggerUpload}
  onlibrary={() => {
    libraryOpen = true;
  }}
/>

<ImageLibraryPickerModal
  bind:open={libraryOpen}
  onpick={handleLibraryPick}
  onupload={triggerUpload}
/>
