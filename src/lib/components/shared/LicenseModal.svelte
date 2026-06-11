<script>
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { publishEventOptimistic } from '$lib/services/publish-service.js';
  import { createAppEventFactory } from '$lib/helpers/event-factory.js';
  import { buildLicenseTemplate } from '$lib/helpers/image-license.js';
  import { getLicenseOptions } from '$lib/helpers/educational/licenseOptions.js';
  import { formatLicenseUrl } from '$lib/helpers/educational/licenseLabel.js';

  let {
    open = $bindable(false),
    hash = '',
    url = '',
    mime = '',
    size = 0,
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
    oncancel = () => {}
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

  // Existing-license tag readers
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

  function acceptExisting() {
    if (!existingLicense) return;
    open = false;
    onsave(existingLicense);
  }

  function switchToForm() {
    view = 'form';
    modalError = '';
  }

  async function handleSave() {
    modalError = '';
    if (!hash || !url) {
      modalError = m.license_modal_error_missing_hash();
      return;
    }
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
      const template = buildLicenseTemplate({
        hash,
        url,
        mime,
        size,
        license: modalLicense,
        credit: modalCredit,
        title: modalTitle || undefined,
        source: modalSource || undefined,
        creatorPubkey: modalSelfCreator ? effectiveSigner.pubkey : undefined,
        description: modalDescription || undefined
      });
      const factory = createAppEventFactory();
      const eventTemplate = await factory.build(template);
      const signed = await effectiveSigner.signEvent(eventTemplate);
      eventStore.add(signed);
      publishEventOptimistic(signed, [], {});
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

{#if open}
  <div class="modal-open modal" data-testid="license-modal">
    <div class="modal-box max-w-2xl">
      {#if view === 'existing' && existingLicense}
        <!-- State A: existing license found, ask user to accept or create their own -->
        <h3 class="mb-2 text-lg font-bold">{m.license_modal_existing_title()}</h3>
        <p class="mb-4 text-sm opacity-70">{m.license_modal_existing_description()}</p>

        <div class="mb-4 rounded-lg border border-base-300 bg-base-200 p-4 text-sm">
          <dl class="space-y-2">
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
          >
            {m.license_modal_accept_existing()}
          </button>
        </div>
      {:else}
        <!-- State B: create a new license event -->
        <h3 class="mb-2 text-lg font-bold">{m.license_modal_title()}</h3>
        <p class="mb-4 text-sm opacity-70">{m.license_modal_description()}</p>

        <!-- Title (TULLU: Titel — the work's title, distinct from description/alt) -->
        <div class="form-control mb-3">
          <label class="label" for="license-modal-title">
            <span class="label-text">{m.license_modal_title_field_label()}</span>
          </label>
          <input
            id="license-modal-title"
            type="text"
            class="input-bordered input"
            placeholder={m.license_modal_title_field_placeholder()}
            bind:value={modalTitle}
          />
        </div>

        <div class="form-control mb-3">
          <label class="label" for="license-modal-license">
            <span class="label-text">{m.license_modal_license_label()}</span>
          </label>
          <select
            id="license-modal-license"
            class="select-bordered select"
            bind:value={modalLicense}
          >
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

        <div class="form-control mb-3">
          <label class="label cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              class="checkbox mt-1"
              data-testid="license-modal-disclosure"
              bind:checked={modalDisclosureChecked}
            />
            <span class="label-text">{m.license_modal_disclosure_label()}</span>
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
