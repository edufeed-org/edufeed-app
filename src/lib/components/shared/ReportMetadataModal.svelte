<!--
  ReportMetadataModal
  Lets a viewer privately flag wrong metadata on a kind 30142 resource by
  sending a templated NIP-17 DM to the resource author. Store-driven modal,
  registered in ModalManager.
-->

<script>
  import { CloseIcon } from '$lib/components/icons';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { actionRunnerOptimistic } from '$lib/stores/action-runner.svelte.js';
  import { ensureDmRelayList } from '$lib/services/dm-relay-backfill.js';
  import { SendWrappedMessage } from 'applesauce-actions/actions';
  import { showToast } from '$lib/helpers/toast.js';
  import { getCanonicalEventRoute } from '$lib/helpers/eventRouteRedirect.js';
  import { buildMetadataFeedbackMessage } from '$lib/helpers/metadata-feedback.js';
  import * as m from '$lib/paraglide/messages';

  let { modalId = 'report-metadata-modal' } = $props();

  let event = $derived(/** @type {any} */ (modalStore.modalProps)?.event);

  const fieldOptions = $derived([
    { value: 'License', label: m.report_metadata_field_license() },
    { value: 'Attribution', label: m.report_metadata_field_attribution() },
    { value: 'Title', label: m.report_metadata_field_title() },
    { value: 'Subject', label: m.report_metadata_field_subject() },
    { value: 'Other', label: m.report_metadata_field_other() }
  ]);

  let selectedField = $state('');
  let comment = $state('');
  let isSubmitting = $state(false);

  let canSubmit = $derived(!!selectedField && comment.trim().length > 0 && !isSubmitting);

  function handleClose() {
    modalStore.closeModal();
  }

  async function handleSubmit() {
    if (!canSubmit || !event) return;
    isSubmitting = true;

    const route = getCanonicalEventRoute(event);
    const url = route ? `${window.location.origin}${route}` : '';
    const findTag = (/** @type {string} */ name) =>
      event.tags?.find((/** @type {string[]} */ t) => t[0] === name)?.[1];
    const title = findTag('name') || findTag('title') || '';
    const fieldLabel = fieldOptions.find((o) => o.value === selectedField)?.label || selectedField;

    const body = buildMetadataFeedbackMessage({ title, url, fieldLabel, comment });

    try {
      await ensureDmRelayList();
      await actionRunnerOptimistic.run(SendWrappedMessage, [event.pubkey], body);
      showToast(m.report_metadata_success(), 'success');
      modalStore.closeModal();
    } catch (err) {
      console.error('Failed to send metadata feedback:', err);
      showToast(m.report_metadata_error(), 'error');
    } finally {
      isSubmitting = false;
    }
  }
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box w-11/12 max-w-lg">
    <div class="mb-2 flex items-center justify-between">
      <h3 class="text-lg font-bold">{m.report_metadata_modal_title()}</h3>
      <button class="btn btn-circle btn-ghost btn-sm" onclick={handleClose} aria-label="Close">
        <CloseIcon class_="h-5 w-5" />
      </button>
    </div>
    <p class="mb-4 text-sm text-base-content/60">{m.report_metadata_modal_description()}</p>

    <form
      onsubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <div class="form-control mb-3">
        <label class="label" for="report-metadata-field">
          <span class="label-text">{m.report_metadata_field_label()}</span>
        </label>
        <select
          id="report-metadata-field"
          class="select-bordered select w-full"
          bind:value={selectedField}
          disabled={isSubmitting}
        >
          <option value="" disabled>{m.report_metadata_field_placeholder()}</option>
          {#each fieldOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>

      <div class="form-control mb-3">
        <label class="label" for="report-metadata-comment">
          <span class="label-text">{m.report_metadata_comment_label()}</span>
        </label>
        <textarea
          id="report-metadata-comment"
          class="textarea-bordered textarea h-28 w-full"
          placeholder={m.report_metadata_comment_placeholder()}
          bind:value={comment}
          disabled={isSubmitting}
        ></textarea>
      </div>

      <div class="modal-action">
        <button type="button" class="btn" onclick={handleClose}>{m.common_cancel()}</button>
        <button type="submit" class="btn btn-primary" disabled={!canSubmit}>
          {#if isSubmitting}
            <span class="loading loading-sm loading-spinner"></span>
          {/if}
          {m.report_metadata_submit()}
        </button>
      </div>
    </form>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button onclick={handleClose}>close</button>
  </form>
</dialog>
