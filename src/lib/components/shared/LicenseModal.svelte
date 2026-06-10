<script>
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { publishEventOptimistic } from '$lib/services/publish-service.js';
  import { createAppEventFactory } from '$lib/helpers/event-factory.js';
  import { buildLicenseTemplate } from '$lib/helpers/image-license.js';
  import { getLicenseOptions } from '$lib/helpers/educational/licenseOptions.js';

  let {
    open = $bindable(false),
    hash = '',
    url = '',
    mime = '',
    size = 0,
    activeUserDisplayName = '',
    /** @type {(license: any) => void} */
    onsave = () => {},
    /** @type {() => void} */
    oncancel = () => {}
  } = $props();

  let modalLicense = $state('https://creativecommons.org/licenses/by/4.0/');
  let modalCredit = $state('');
  let modalSelfCreator = $state(false);
  let modalSource = $state('');
  let modalDescription = $state('');
  let modalSaving = $state(false);
  let modalError = $state('');

  const licenseOptions = $derived(getLicenseOptions(modalLicense));

  // Reset modal fields each time it opens. The effect re-runs on every change
  // of `open` but the `if (open)` guard ensures we only reset on the rising edge.
  $effect(() => {
    if (open) {
      modalLicense = 'https://creativecommons.org/licenses/by/4.0/';
      modalCredit = activeUserDisplayName || '';
      modalSelfCreator = !!activeUserDisplayName;
      modalSource = '';
      modalDescription = '';
      modalError = '';
    }
  });

  function toggleSelfCreator() {
    modalSelfCreator = !modalSelfCreator;
    if (modalSelfCreator && activeUserDisplayName) {
      modalCredit = activeUserDisplayName;
    }
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
    modalSaving = true;
    try {
      const signer = manager.active;
      if (!signer) throw new Error('No active account');
      const template = buildLicenseTemplate({
        hash,
        url,
        mime,
        size,
        license: modalLicense,
        credit: modalCredit,
        source: modalSource || undefined,
        creatorPubkey: modalSelfCreator ? signer.pubkey : undefined,
        description: modalDescription || undefined
      });
      const factory = createAppEventFactory();
      const eventTemplate = await factory.build(template);
      const signed = await signer.signEvent(eventTemplate);
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
        <button type="button" class="btn btn-ghost" onclick={handleCancel} disabled={modalSaving}>
          {m.license_modal_cancel()}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          data-testid="license-modal-save"
          onclick={handleSave}
          disabled={modalSaving}
        >
          {#if modalSaving}<span class="loading loading-sm loading-spinner"></span>{/if}
          {m.license_modal_save()}
        </button>
      </div>
    </div>
  </div>
{/if}
