<script>
  import { getSha256FromURL } from 'applesauce-common/helpers';
  import * as m from '$lib/paraglide/messages';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { uploadWithFallback } from '$lib/helpers/blossom-upload.js';
  import { useLicenseForHash } from '$lib/stores/image-license.svelte.js';
  import { findExistingLicense } from '$lib/helpers/image-license.js';
  import { reconcileBlobUrlScheme } from '$lib/helpers/blossom-trust.js';
  import { sha256Hex } from '$lib/helpers/sha256.js';
  import LicenseBadge from './LicenseBadge.svelte';
  import ImageWithFallback from './ImageWithFallback.svelte';
  import { PersonIcon } from '$lib/components/icons';
  import LicenseModal from './LicenseModal.svelte';
  import ImageSourceChooserModal from './ImageSourceChooserModal.svelte';
  import ImageLibraryPickerModal from './ImageLibraryPickerModal.svelte';
  import MetadataCleanerModal from './MetadataCleanerModal.svelte';
  import { isSupportedFile, cleanFileQuietly } from '$lib/helpers/metaclean.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';

  let {
    imageUrl = $bindable(''),
    imageWasUploaded = $bindable(false),
    licenseEvent = $bindable(null),
    errors = {},
    activeUserDisplayName = '',
    // 'avatar': a round live preview of imageUrl beside the field. A pasted
    // URL gave no feedback at all before (issue f2763558: the tester assumed
    // it was not taken and reached for the add button instead).
    /** @type {'avatar' | null} */
    previewShape = null
  } = $props();

  // Hash currently associated with imageUrl (from upload or paste-of-Blossom).
  let currentHash = $state(/** @type {string | null} */ (null));
  let uploading = $state(false);
  let modalOpen = $state(false);
  let chooserOpen = $state(false);
  let libraryOpen = $state(false);

  // Quiet metaclean opt-in, surfaced as extra options inside the license
  // modal (see metacleanOptions snippet below) instead of a blocking
  // interstitial. Images can't be compressed (only PDFs), so there's no
  // compression select here — just the strip checkbox + inspect link.
  let cleanMetadata = $state(false);
  let inspectOpen = $state(false);
  // Display-only: hidden metadata fields removed on upload / clean failure.
  let metaCleanedFields = $state(0);
  let metaCleanFailed = $state(false);

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

  // A pasted non-Blossom URL whose bytes the server hashed for us
  // (/api/image-hash). The browser cannot hash a foreign image (CORS), but a
  // kind-1063 attestation is keyed by SHA-256 — so this is what lets the user
  // record a license for an external image, not only for an upload. Null while
  // nothing external is pasted, the lookup is still running, or it failed.
  let externalHashedUrl = $state(/** @type {string | null} */ (null));
  let externalLookupToken = 0;

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
   * Hash a pasted external URL through the server. Any failure (private host,
   * not an image, too large, endpoint down) leaves the field exactly as it
   * was before: a plain URL with no hash, no badge and no license button.
   * @param {string} url
   */
  async function hashExternalUrl(url) {
    const myToken = ++externalLookupToken;
    try {
      const res = await fetch(`/api/image-hash?url=${encodeURIComponent(url)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (myToken !== externalLookupToken || imageUrl !== url) return; // superseded
      if (typeof data?.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(data.sha256)) return;
      currentHash = data.sha256;
      modalMime = typeof data.mime === 'string' && data.mime ? data.mime : 'image/jpeg';
      modalSize = typeof data.size === 'number' ? data.size : undefined;
      externalHashedUrl = url;
    } catch {
      // degrade to today's behaviour: URL without license information
    }
  }

  async function handleAttestExternal() {
    if (!currentHash) return;
    pendingExistingLicense = await findExistingLicense(currentHash);
    modalOpen = true;
  }

  /**
   * @param {{ url: string, hash: string, licenseEvent: any }} picked
   */
  function handleLibraryPick(picked) {
    imageUrl = picked.url;
    currentHash = picked.hash;
    // library-picked images already carry a licenseEvent; skip the upload gate
    imageWasUploaded = false;
    // The picked image was never run through the quiet-clean pipeline — any
    // note left over from a previously uploaded/cleaned image no longer
    // applies to this image.
    metaCleanedFields = 0;
    metaCleanFailed = false;
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
    // Reset quiet-metaclean opt-in state for the new pick — a re-opened
    // modal for a fresh file must never inherit a previous file's checkbox
    // state or clean/failure note.
    cleanMetadata = false;
    inspectOpen = false;
    metaCleanedFields = 0;
    metaCleanFailed = false;

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

    // Quiet clean: only runs when the user opted in via the license modal's
    // checkbox. Never throws — a failed clean falls back to uploading the
    // original file, noted under the field. Operates on a local variable so
    // pendingFile stays untouched on failure (matches LicensedFileInput).
    let uploadFile = pendingFile;
    if (cleanMetadata) {
      const result = await cleanFileQuietly(uploadFile, { strip: true });
      if (result) {
        uploadFile = result.file;
        metaCleanedFields = result.cleaned ? result.removedCount : 0;
        metaCleanFailed = false;
      } else {
        metaCleanFailed = true; // service down — upload the original, note it
      }
    }

    const { blob, serverUrl } = await uploadWithFallback(uploadFile, {
      signer,
      userPubkey: signer.pubkey || ''
    });

    const finalUrl = reconcileBlobUrlScheme(blob.url, serverUrl);
    imageUrl = finalUrl;
    imageWasUploaded = true;
    currentHash = blob.sha256;
    return {
      url: finalUrl,
      hash: blob.sha256,
      mime: blob.type || uploadFile.type,
      size: blob.size ?? uploadFile.size
    };
  }

  function handleUrlBlur() {
    // Any note about a previously uploaded/cleaned image no longer applies
    // once the URL field is edited or cleared — it no longer points at that
    // file.
    metaCleanedFields = 0;
    metaCleanFailed = false;
    externalHashedUrl = null;
    externalLookupToken++;
    if (!imageUrl) {
      currentHash = null;
      imageWasUploaded = false;
      return;
    }
    const hashFromUrl = getSha256FromURL(imageUrl);
    currentHash = hashFromUrl ?? null;
    imageWasUploaded = false;
    if (!hashFromUrl && /^https?:\/\//i.test(imageUrl)) {
      void hashExternalUrl(imageUrl);
    }
  }

  // Offer "add a license" only for an external image the server could hash
  // and that nobody has attested yet. Uploads get the modal automatically.
  const canAttestExternal = $derived(
    !!externalHashedUrl && externalHashedUrl === imageUrl && !!currentHash && !licenseEvent
  );
</script>

<div class="form-control">
  <div class="flex items-center gap-3">
    {#if previewShape === 'avatar'}
      <div
        class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-base-300 bg-base-200"
        data-testid="licensed-image-preview"
      >
        {#if imageUrl}
          <ImageWithFallback
            src={imageUrl}
            alt=""
            size="avatar_md"
            class="h-16 w-16 rounded-full object-cover"
            fallbackType="avatar"
            robohash={false}
          />
        {:else}
          <PersonIcon class_="h-7 w-7 text-base-content/40" />
        {/if}
      </div>
    {/if}
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

  {#if canAttestExternal}
    <div class="mt-2 flex items-center gap-2 text-xs">
      <span class="text-base-content/70">{m.licensed_image_input_external_no_license()}</span>
      <button
        type="button"
        class="btn btn-outline btn-sm"
        data-testid="licensed-image-attest-external"
        onclick={handleAttestExternal}
      >
        {m.licensed_image_input_attest_external()}
      </button>
    </div>
  {:else if licenseEvent}
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

  {#if metaCleanedFields}
    <p class="mt-1 text-xs text-success">
      {m.metaclean_removed_note({ count: String(metaCleanedFields) })}
    </p>
  {:else if metaCleanFailed}
    <p class="mt-1 text-xs text-warning">{m.metaclean_clean_failed_note()}</p>
  {/if}

  {#if uploadError || errors.image}
    <p class="mt-1 text-xs text-error">{uploadError || errors.image}</p>
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
  hash={currentHash || ''}
  url={imageUrl}
  mime={modalMime}
  size={modalSize ?? 0}
  fileName={pendingFile?.name ?? ''}
  {activeUserDisplayName}
  existingLicense={pendingExistingLicense}
  extraOptions={runtimeConfig.metadataCleaner?.enabled &&
  pendingFile &&
  isSupportedFile(pendingFile)
    ? metacleanOptions
    : null}
  beforeAttest={pendingFile ? performUpload : null}
  onsave={(/** @type {any} */ license) => {
    licenseEvent = license;
    pendingExistingLicense = null;
    pendingFile = null;
  }}
  oncancel={() => {
    // An external image was only being attested, not added: cancelling keeps
    // the pasted URL and simply leaves it without a license, as before.
    if (externalHashedUrl) {
      pendingExistingLicense = null;
      return;
    }
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

<MetadataCleanerModal bind:open={inspectOpen} file={pendingFile} mode="inspect" />

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
