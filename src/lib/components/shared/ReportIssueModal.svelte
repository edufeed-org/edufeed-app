<!--
  ReportIssueModal — in-app feedback / bug report.

  Files a public NIP-34 issue (kind 1621) on the edufeed-app repository
  announcement, signed by the active account, exactly like `ngit issue
  create`. Opened from the account menu (plain feedback) and from
  RenderErrorCard (prefilled with the error + context). Store-driven,
  registered lazily in ModalManager.

  modalProps.prefill: { subject?, description?, type?, context? } — when no
  context is given it is collected on submit (route, app version, UA).
-->

<script>
  import { tick } from 'svelte';
  import { CloseIcon } from '$lib/components/icons';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { collectReportContext, formatContextSection } from '$lib/helpers/issue-report.js';
  import { submitIssueReport } from '$lib/services/issue-report.js';
  import * as m from '$lib/paraglide/messages';

  let { modalId = 'report-issue-modal' } = $props();

  const getActiveUser = useActiveUser();

  /** @type {any} */
  const prefill = /** @type {any} */ (modalStore.modalProps)?.prefill ?? {};

  /** @type {'bug' | 'idea'} */
  let type = $state(prefill.type === 'idea' ? 'idea' : 'bug');
  let subject = $state(/** @type {string} */ (prefill.subject ?? ''));
  let description = $state(/** @type {string} */ (prefill.description ?? ''));
  let isSubmitting = $state(false);

  // Context is captured once, when the modal opens: the route the user was on
  // (or, for RenderErrorCard, the error it was opened with).
  const context =
    prefill.context ?? collectReportContext({ appName: runtimeConfig.appName || undefined });
  const contextPreview = formatContextSection(context);

  const canSubmit = $derived(
    !!getActiveUser()?.signer &&
      subject.trim().length > 0 &&
      description.trim().length > 0 &&
      !isSubmitting
  );

  function handleClose() {
    modalStore.closeModal();
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    isSubmitting = true;
    try {
      const { url } = await submitIssueReport(
        { subject, description, type, context },
        getActiveUser()
      );
      // Close first and let the DOM flush: showToast targets an open <dialog>
      // when one exists, and a toast appended inside this one would vanish
      // with it.
      modalStore.closeModal();
      await tick();
      showToast(m.report_issue_success(), 'success', 10_000, {
        link: { href: url, label: m.report_issue_success_link() }
      });
    } catch (err) {
      console.error('Failed to file issue report:', err);
      showToast(m.report_issue_error(), 'error');
    } finally {
      isSubmitting = false;
    }
  }
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box w-11/12 max-w-lg">
    <div class="mb-2 flex items-center justify-between">
      <h3 class="text-lg font-bold">{m.report_issue_modal_title()}</h3>
      <button class="btn btn-circle btn-ghost btn-sm" onclick={handleClose} aria-label="Close">
        <CloseIcon class_="h-5 w-5" />
      </button>
    </div>
    <p class="mb-4 text-sm text-base-content/60">{m.report_issue_modal_description()}</p>

    <form
      data-testid="report-issue-form"
      onsubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <fieldset class="form-control mb-3">
        <legend class="label"><span class="label-text">{m.report_issue_type_label()}</span></legend>
        <div class="flex gap-4">
          <label class="label cursor-pointer gap-2">
            <input
              type="radio"
              class="radio radio-sm"
              name="report-issue-type"
              value="bug"
              bind:group={type}
              disabled={isSubmitting}
            />
            <span class="label-text">{m.report_issue_type_bug()}</span>
          </label>
          <label class="label cursor-pointer gap-2">
            <input
              type="radio"
              class="radio radio-sm"
              name="report-issue-type"
              value="idea"
              bind:group={type}
              disabled={isSubmitting}
            />
            <span class="label-text">{m.report_issue_type_idea()}</span>
          </label>
        </div>
      </fieldset>

      <div class="form-control mb-3">
        <label class="label" for="report-issue-subject">
          <span class="label-text">{m.report_issue_subject_label()}</span>
        </label>
        <input
          id="report-issue-subject"
          type="text"
          class="input-bordered input w-full"
          placeholder={m.report_issue_subject_placeholder()}
          maxlength="120"
          bind:value={subject}
          disabled={isSubmitting}
        />
      </div>

      <div class="form-control mb-3">
        <label class="label" for="report-issue-description">
          <span class="label-text">{m.report_issue_description_label()}</span>
        </label>
        <textarea
          id="report-issue-description"
          class="textarea-bordered textarea h-28 w-full"
          placeholder={m.report_issue_description_placeholder()}
          bind:value={description}
          disabled={isSubmitting}
        ></textarea>
      </div>

      <details class="collapse-arrow collapse mb-3 rounded-lg bg-base-200">
        <summary class="collapse-title min-h-0 py-2 text-sm font-medium">
          {m.report_issue_context_label()}
        </summary>
        <div class="collapse-content text-xs">
          <p class="mb-2 text-base-content/60">{m.report_issue_context_hint()}</p>
          <pre
            data-testid="report-issue-context"
            class="max-h-48 overflow-auto break-all whitespace-pre-wrap">{contextPreview}</pre>
        </div>
      </details>

      {#if !getActiveUser()?.signer}
        <p class="mb-3 text-sm text-warning" data-testid="report-issue-login-hint">
          {m.report_issue_login_required()}
        </p>
      {/if}

      <div class="modal-action">
        <button type="button" class="btn" onclick={handleClose}>{m.common_cancel()}</button>
        <button type="submit" class="btn btn-primary" disabled={!canSubmit}>
          {#if isSubmitting}
            <span class="loading loading-sm loading-spinner"></span>
          {/if}
          {m.report_issue_submit()}
        </button>
      </div>
    </form>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button onclick={handleClose}>close</button>
  </form>
</dialog>
