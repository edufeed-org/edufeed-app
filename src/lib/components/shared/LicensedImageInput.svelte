<script>
  import { BlossomClient } from 'blossom-client-sdk';
  import { getSha256FromURL } from 'applesauce-common/helpers';
  import * as m from '$lib/paraglide/messages';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { getActiveBlossomServer } from '$lib/services/blossom-settings-service.js';
  import { publishEventOptimistic } from '$lib/services/publish-service.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useLicenseForHash } from '$lib/stores/image-license.svelte.js';
  import { buildLicenseTemplate } from '$lib/helpers/image-license.js';
  import { getLicenseOptions } from '$lib/helpers/educational/licenseOptions.js';
  import { createAppEventFactory } from '$lib/helpers/event-factory.js';

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

  // Modal form state
  let modalLicense = $state('https://creativecommons.org/licenses/by/4.0/');
  let modalCredit = $state('');
  let modalSelfCreator = $state(false);
  let modalSource = $state('');
  let modalDescription = $state('');
  let modalSize = $state(/** @type {number | undefined} */ (undefined));
  let modalMime = $state('image/jpeg');
  let modalSaving = $state(false);
  let modalError = $state('');

  // Upload-side ephemeral error (invalid file type, too large, upload failed).
  // Kept separate from `errors` prop which is owned by the wizard's $derived validator.
  let uploadError = $state('');

  // Reactive license event from EventStore.
  const getLicense = useLicenseForHash(() => currentHash);
  $effect(() => {
    licenseEvent = getLicense();
  });

  const licenseOptions = $derived(getLicenseOptions(modalLicense));

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

      // Wait one microtask for useLicenseForHash to settle; if no existing
      // license event is in store, open the modal.
      await Promise.resolve();
      if (!getLicense()) {
        openModal();
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

  function openModal() {
    modalLicense = 'https://creativecommons.org/licenses/by/4.0/';
    modalCredit = '';
    modalSelfCreator = false;
    modalSource = '';
    modalDescription = '';
    modalError = '';
    modalOpen = true;
  }

  function toggleSelfCreator() {
    modalSelfCreator = !modalSelfCreator;
    if (modalSelfCreator && activeUserDisplayName) {
      modalCredit = activeUserDisplayName;
    }
  }

  async function saveLicense() {
    modalError = '';
    if (!currentHash || !imageUrl) return;
    if (!modalLicense || !modalCredit) {
      modalError = m.amb_form_validation_image_license_missing();
      return;
    }
    modalSaving = true;
    try {
      const signer = manager.active;
      if (!signer) throw new Error('No active account');
      const { kind, content, tags } = buildLicenseTemplate({
        hash: currentHash,
        url: imageUrl,
        mime: modalMime,
        license: modalLicense,
        credit: modalCredit,
        source: modalSource || undefined,
        creatorPubkey: modalSelfCreator ? signer.pubkey : undefined,
        description: modalDescription || undefined,
        size: modalSize
      });
      const factory = createAppEventFactory();
      const eventTemplate = await factory.build({ kind, content, tags });
      const signed = await signer.signEvent(eventTemplate);
      eventStore.add(signed);
      publishEventOptimistic(signed, [], {});
      modalOpen = false;
    } catch (e) {
      console.error('License publish failed', e);
      modalError = m.license_modal_publish_failed();
    } finally {
      modalSaving = false;
    }
  }

  function closeModal() {
    modalOpen = false;
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

  {#if uploadError || errors.image}
    <p class="mt-1 text-xs text-error">{uploadError || errors.image}</p>
  {/if}
</div>

{#if modalOpen}
  <div class="modal-open modal" data-testid="license-modal">
    <div class="modal-box">
      <h3 class="mb-2 text-lg font-bold">{m.license_modal_title()}</h3>
      <p class="mb-4 text-sm opacity-70">{m.license_modal_description()}</p>

      <div class="form-control mb-3">
        <label class="label" for="license-modal-license">
          <span class="label-text">{m.license_modal_license_label()}</span>
        </label>
        <select id="license-modal-license" class="select-bordered select" bind:value={modalLicense}>
          {#each licenseOptions as opt (opt.id)}
            <option value={opt.id}>{opt.label}</option>
          {/each}
        </select>
      </div>

      <div class="form-control mb-3">
        <label class="label cursor-pointer justify-start gap-2">
          <input
            type="checkbox"
            class="checkbox"
            checked={modalSelfCreator}
            onchange={toggleSelfCreator}
          />
          <span class="label-text">{m.license_modal_self_creator()}</span>
        </label>
      </div>

      <div class="form-control mb-3">
        <label class="label" for="license-modal-credit">
          <span class="label-text">{m.license_modal_credit_label()}</span>
        </label>
        <input
          id="license-modal-credit"
          type="text"
          class="input-bordered input"
          placeholder={m.license_modal_credit_placeholder()}
          bind:value={modalCredit}
        />
      </div>

      <div class="form-control mb-3">
        <label class="label" for="license-modal-source">
          <span class="label-text">{m.license_modal_source_label()}</span>
        </label>
        <input
          id="license-modal-source"
          type="url"
          class="input-bordered input"
          bind:value={modalSource}
        />
      </div>

      <div class="form-control mb-3">
        <label class="label" for="license-modal-desc">
          <span class="label-text">{m.license_modal_description_label()}</span>
        </label>
        <textarea
          id="license-modal-desc"
          class="textarea-bordered textarea"
          bind:value={modalDescription}
        ></textarea>
      </div>

      {#if modalError}
        <p class="mb-2 text-xs text-error">{modalError}</p>
      {/if}

      <div class="modal-action">
        <button type="button" class="btn btn-ghost" onclick={closeModal} disabled={modalSaving}>
          {m.license_modal_cancel()}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          data-testid="license-modal-save"
          onclick={saveLicense}
          disabled={modalSaving}
        >
          {#if modalSaving}
            <span class="loading loading-sm loading-spinner"></span>
          {/if}
          {m.license_modal_save()}
        </button>
      </div>
    </div>
  </div>
{/if}
