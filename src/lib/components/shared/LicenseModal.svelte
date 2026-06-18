<script>
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import { publishLicenseAttestation } from '$lib/helpers/image-license.js';
  import { getLicenseOptions } from '$lib/helpers/educational/licenseOptions.js';
  import { formatLicenseUrl } from '$lib/helpers/educational/licenseLabel.js';

  let {
    open = $bindable(false),
    hash = '',
    url = '',
    mime = '',
    size = 0,
    /** Name of the file being licensed — shown so the user knows which file the modal refers to (important in multi-file flows). */
    fileName = '',
    activeUserDisplayName = '',
    defaultSelfCreator = false,
    existingLicense = /** @type {any} */ (null),
    /**
     * Signer used to publish the kind 1063 attestation. Falls back to
     * `manager.active` when not provided. Set this to a community signer when
     * attesting the community's own uploads (avatar / banner) so the license
     * event is signed by the community's keypair, not the active user's.
     */
    signer = /** @type {{ pubkey: string, signEvent: (e: any) => Promise<any> } | null} */ (null),
    /** @type {(license: any) => void} */
    onsave = () => {},
    /** @type {() => void} */
    oncancel = () => {},
    /** @type {(() => Promise<{ url: string, hash: string, mime: string, size: number }>) | null} */
    beforeAttest = null
  } = $props();

  let modalLicense = $state('https://creativecommons.org/licenses/by/4.0/');
  let modalTitle = $state('');
  let modalCredit = $state('');
  let modalSelfCreator = $state(false);
  let modalSource = $state('');
  let modalDescription = $state('');
  let modalSaving = $state(false);
  let modalError = $state('');
  let modalDisclosureChecked = $state(false);

  // Two-state modal:
  //   - 'existing': showing the existing license event with Accept / Create-my-own
  //   - 'form':     the standard create-a-license form
  // Defaults to 'existing' when `existingLicense` is provided, else 'form'.
  let view = $state(/** @type {'existing' | 'form'} */ ('form'));

  const licenseOptions = $derived(getLicenseOptions(modalLicense));

  // Image vs generic file wording. An empty mime (e.g. avatar/banner uploaders
  // that only ever handle images) keeps the image wording.
  const isImage = $derived(!mime || mime.startsWith('image/'));

  // Existing-license tag readers
  const existingTitle = $derived(
    existingLicense?.tags.find(/** @param {string[]} t */ (t) => t[0] === 'title')?.[1] ?? null
  );
  const existingLicenseUrl = $derived(
    existingLicense?.tags.find(/** @param {string[]} t */ (t) => t[0] === 'license')?.[1] ?? null
  );
  const existingCredit = $derived(
    existingLicense?.tags.find(/** @param {string[]} t */ (t) => t[0] === 'credit')?.[1] ?? null
  );
  const existingSource = $derived(
    existingLicense?.tags.find(/** @param {string[]} t */ (t) => t[0] === 'source')?.[1] ?? null
  );
  const existingDescription = $derived(existingLicense?.content || '');
  const existingLicenseLabel = $derived(
    existingLicenseUrl ? formatLicenseUrl(existingLicenseUrl) : null
  );

  // Reset modal fields each time it opens. The effect re-runs on every change
  // of `open` but the `if (open)` guard ensures we only reset on the rising edge.
  $effect(() => {
    if (open) {
      modalLicense = 'https://creativecommons.org/licenses/by/4.0/';
      modalTitle = '';
      modalSelfCreator = defaultSelfCreator;
      modalCredit = defaultSelfCreator && activeUserDisplayName ? activeUserDisplayName : '';
      modalSource = '';
      modalDescription = '';
      modalError = '';
      modalDisclosureChecked = false;
      view = existingLicense ? 'existing' : 'form';
    }
  });

  function toggleSelfCreator() {
    modalSelfCreator = !modalSelfCreator;
    if (modalSelfCreator && activeUserDisplayName) {
      modalCredit = activeUserDisplayName;
    }
  }

  async function acceptExisting() {
    if (!existingLicense) return;
    modalError = '';
    modalSaving = true;
    try {
      if (beforeAttest) {
        await beforeAttest();
      }
      open = false;
      onsave(existingLicense);
    } catch (e) {
      console.error('Accept-existing upload failed', e);
      modalError = m.license_modal_upload_failed();
    } finally {
      modalSaving = false;
    }
  }

  function switchToForm() {
    view = 'form';
    modalError = '';
  }

  async function handleSave() {
    modalError = '';
    if (!modalLicense || !modalCredit) {
      modalError = m.amb_form_validation_image_license_missing();
      return;
    }
    if (!modalDisclosureChecked) {
      modalError = m.license_modal_disclosure_required_error();
      return;
    }
    modalSaving = true;
    try {
      const effectiveSigner = signer ?? manager.active;
      if (!effectiveSigner) throw new Error('No active account');

      // If a beforeAttest hook is provided, run it now. Its return value supplies
      // the (possibly freshly-uploaded) url/hash/mime/size we use for the kind 1063
      // tags. When no hook is provided, fall back to the props passed by the parent.
      let attestUrl = url;
      let attestHash = hash;
      let attestMime = mime;
      let attestSize = size;
      if (beforeAttest) {
        let out;
        try {
          out = await beforeAttest();
        } catch (e) {
          console.error('Deferred upload failed', e);
          modalError = m.license_modal_upload_failed();
          return;
        }
        attestUrl = out.url;
        attestHash = out.hash;
        attestMime = out.mime;
        attestSize = out.size;
      }

      if (!attestHash || !attestUrl) {
        modalError = m.license_modal_error_missing_hash();
        return;
      }

      const signed = await publishLicenseAttestation(
        {
          hash: attestHash,
          url: attestUrl,
          mime: attestMime,
          size: attestSize,
          license: modalLicense,
          credit: modalCredit,
          title: modalTitle || undefined,
          source: modalSource || undefined,
          creatorPubkey: modalSelfCreator ? effectiveSigner.pubkey : undefined,
          description: modalDescription || undefined
        },
        effectiveSigner
      );
      open = false;
      onsave(signed);
    } catch (e) {
      console.error('License publish failed', e);
      modalError = m.license_modal_publish_failed();
    } finally {
      modalSaving = false;
    }
  }

  function handleCancel() {
    open = false;
    oncancel();
  }
</script>

{#snippet fileNameChip()}
  {#if fileName}
    <div
      class="mb-4 flex items-center gap-2 rounded-lg bg-base-200 px-3 py-2 text-sm"
      data-testid="license-modal-filename"
    >
      <span class="shrink-0 font-medium opacity-70">{m.license_modal_file_label()}:</span>
      <span class="min-w-0 truncate" title={fileName}>{fileName}</span>
    </div>
  {/if}
{/snippet}

{#if open}
  <div class="modal-open modal" data-testid="license-modal">
    <div class="modal-box max-w-2xl">
      {#if view === 'existing' && existingLicense}
        <!-- State A: existing license found, ask user to accept or create their own -->
        <h3 class="mb-2 text-lg font-bold">{m.license_modal_existing_title()}</h3>
        <p class="mb-4 text-sm opacity-70">
          {isImage
            ? m.license_modal_existing_description()
            : m.license_modal_existing_description_file()}
        </p>

        {@render fileNameChip()}

        <div class="mb-4 rounded-lg border border-base-300 bg-base-200 p-4 text-sm">
          <dl class="space-y-2">
            {#if existingTitle}
              <div class="flex gap-2">
                <dt class="w-24 font-medium">{m.license_modal_title_label()}</dt>
                <dd class="min-w-0 break-words">{existingTitle}</dd>
              </div>
            {/if}
            {#if existingLicenseLabel}
              <div class="flex gap-2">
                <dt class="w-24 font-medium">{m.license_modal_license_label()}</dt>
                <dd>
                  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external link -->
                  <a
                    href={existingLicenseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="link">{existingLicenseLabel}</a
                  >
                </dd>
              </div>
            {/if}
            {#if existingCredit}
              <div class="flex gap-2">
                <dt class="w-24 font-medium">{m.license_modal_credit_label()}</dt>
                <dd>{existingCredit}</dd>
              </div>
            {/if}
            {#if existingSource}
              <div class="flex gap-2">
                <dt class="w-24 font-medium">{m.license_modal_source_label()}</dt>
                <dd class="break-all">
                  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external link -->
                  <a href={existingSource} target="_blank" rel="noopener noreferrer" class="link"
                    >{existingSource}</a
                  >
                </dd>
              </div>
            {/if}
            {#if existingDescription}
              <div class="flex gap-2">
                <dt class="w-24 font-medium">{m.license_modal_description_label()}</dt>
                <dd>{existingDescription}</dd>
              </div>
            {/if}
            <div class="flex gap-2 text-xs opacity-60">
              <dt class="w-24 font-medium">{m.license_modal_attested_by()}</dt>
              <dd class="break-all">{existingLicense.pubkey}</dd>
            </div>
          </dl>
        </div>

        <div class="modal-action">
          <button type="button" class="btn btn-ghost" onclick={handleCancel}>
            {m.license_modal_cancel()}
          </button>
          <button type="button" class="btn btn-outline" onclick={switchToForm}>
            {m.license_modal_create_own()}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            data-testid="license-modal-accept-existing"
            onclick={acceptExisting}
            disabled={modalSaving}
          >
            {m.license_modal_accept_existing()}
          </button>
        </div>
      {:else}
        <!-- State B: create a new license event -->
        <h3 class="mb-2 text-lg font-bold">
          {isImage ? m.license_modal_title() : m.license_modal_title_file()}
        </h3>
        <p class="mb-4 text-sm opacity-70">
          {isImage ? m.license_modal_description() : m.license_modal_description_file()}
        </p>

        {@render fileNameChip()}

        <!-- Title (TULLU: Titel — the work's title, distinct from description/alt) -->
        <div class="mb-3">
          <label class="mb-1 block text-sm font-medium" for="license-modal-title">
            {m.license_modal_title_field_label()}
          </label>
          <input
            id="license-modal-title"
            type="text"
            class="input-bordered input w-full"
            placeholder={m.license_modal_title_field_placeholder()}
            bind:value={modalTitle}
          />
        </div>

        <div class="mb-3">
          <label class="mb-1 block text-sm font-medium" for="license-modal-license">
            {m.license_modal_license_label()}
          </label>
          <select
            id="license-modal-license"
            class="select-bordered select w-full"
            bind:value={modalLicense}
          >
            {#each licenseOptions as opt (opt.id)}
              <option value={opt.id}>{opt.label}</option>
            {/each}
          </select>
        </div>

        <div class="mb-3">
          <label class="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              class="checkbox mt-0.5 checkbox-sm"
              checked={modalSelfCreator}
              onchange={toggleSelfCreator}
            />
            <span
              >{isImage
                ? m.license_modal_self_creator()
                : m.license_modal_self_creator_file()}</span
            >
          </label>
        </div>

        <div class="mb-3">
          <label class="mb-1 block text-sm font-medium" for="license-modal-credit">
            {m.license_modal_credit_label()}
          </label>
          <input
            id="license-modal-credit"
            type="text"
            class="input-bordered input w-full"
            placeholder={m.license_modal_credit_placeholder()}
            bind:value={modalCredit}
          />
        </div>

        <div class="mb-3">
          <label class="mb-1 block text-sm font-medium" for="license-modal-source">
            {m.license_modal_source_label()}
          </label>
          <input
            id="license-modal-source"
            type="url"
            class="input-bordered input w-full"
            bind:value={modalSource}
          />
        </div>

        <div class="mb-3">
          <label class="mb-1 block text-sm font-medium" for="license-modal-desc">
            {m.license_modal_description_label()}
          </label>
          <textarea
            id="license-modal-desc"
            class="textarea-bordered textarea w-full"
            bind:value={modalDescription}
          ></textarea>
        </div>

        <div class="mt-4 mb-3 rounded-lg border border-base-300 bg-base-200/50 p-3">
          <label class="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              class="checkbox mt-0.5 checkbox-sm"
              data-testid="license-modal-disclosure"
              bind:checked={modalDisclosureChecked}
            />
            <span class="whitespace-normal">{m.license_modal_disclosure_label()}</span>
          </label>
        </div>

        {#if modalError}
          <p class="mb-2 text-xs text-error">{modalError}</p>
        {/if}

        <div class="modal-action">
          <button type="button" class="btn btn-ghost" onclick={handleCancel} disabled={modalSaving}>
            {m.license_modal_cancel()}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            data-testid="license-modal-save"
            onclick={handleSave}
            disabled={modalSaving || !modalDisclosureChecked}
          >
            {#if modalSaving}<span class="loading loading-sm loading-spinner"></span>{/if}
            {m.license_modal_save()}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}
