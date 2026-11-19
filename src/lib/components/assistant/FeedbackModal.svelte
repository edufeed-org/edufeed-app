<script>
  // The thumbs-down dialog of a Termi answer: why, an optional comment, and two
  // consents that start unticked. Sending is the window's job (`onsend`); a failed
  // send keeps the dialog open with everything typed.
  import * as m from '$lib/paraglide/messages';
  import { resolve } from '$app/paths';
  import { FEEDBACK_COMMENT_MAX } from '$lib/termi/feedback.js';

  /**
   * @type {{
   *   signedIn: boolean,
   *   hasPrivacy: boolean,
   *   onsend: (choices: import('./answer-actions.js').FeedbackChoices) => Promise<void>,
   *   onclose: () => void
   * }}
   */
  let { signedIn, hasPrivacy, onsend, onclose } = $props();

  // a static table: the Paraglide namespace is never indexed by a runtime key
  const REASONS = [
    { key: 'nothing_found', label: m.termi_feedback_reason_nothing_found },
    { key: 'wrong', label: m.termi_feedback_reason_wrong },
    { key: 'not_asked', label: m.termi_feedback_reason_not_asked },
    { key: 'too_long_vague', label: m.termi_feedback_reason_too_long_vague },
    { key: 'other', label: m.termi_feedback_reason_other }
  ];

  /** @type {string | null} */
  let reason = $state(null);
  let comment = $state('');
  let attach = $state(false);
  let named = $state(false);
  let sending = $state(false);
  /** null = no failure; otherwise whether the failed try was a named one */
  /** @type {{ named: boolean } | null} */
  let failed = $state(null);

  async function send() {
    if (sending) return;
    sending = true;
    failed = null;
    const choices = {
      vote: /** @type {const} */ ('down'),
      reason,
      comment: comment.trim(),
      attach,
      named
    };
    try {
      await onsend(choices);
      onclose();
    } catch {
      failed = { named: choices.named };
    } finally {
      sending = false;
    }
  }
</script>

<div class="modal-open modal" data-testid="termi-feedback-modal">
  <!-- Escape is the window's: it closes this dialog first (TermiChatWindow onKeydown) -->
  <div
    class="modal-box max-w-sm"
    role="dialog"
    aria-modal="true"
    aria-labelledby="termi-feedback-title"
    tabindex="-1"
    {@attach (/** @type {HTMLElement} */ node) => node.focus()}
  >
    <h3 id="termi-feedback-title" class="text-lg font-semibold">{m.termi_feedback_title()}</h3>

    <div class="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="termi-feedback-title">
      {#each REASONS as r (r.key)}
        <input
          type="radio"
          name="termi-feedback-reason"
          class="btn btn-sm"
          aria-label={r.label()}
          value={r.key}
          bind:group={reason}
        />
      {/each}
    </div>

    <label class="mt-4 flex flex-col gap-1">
      <span class="text-sm">{m.termi_feedback_comment_label()}</span>
      <textarea
        class="textarea w-full"
        rows="3"
        maxlength={FEEDBACK_COMMENT_MAX}
        aria-describedby="termi-feedback-comment-hint"
        bind:value={comment}
      ></textarea>
      <span id="termi-feedback-comment-hint" class="text-xs text-base-content/70">
        {m.termi_feedback_comment_hint()}
      </span>
    </label>

    <label class="mt-4 flex items-start gap-2">
      <input
        type="checkbox"
        class="checkbox mt-0.5 checkbox-sm"
        bind:checked={attach}
        aria-describedby="termi-feedback-attach-hint"
      />
      <span class="text-sm">{m.termi_feedback_attach()}</span>
    </label>
    <p id="termi-feedback-attach-hint" class="mt-1 pl-7 text-xs text-base-content/70">
      {m.termi_feedback_attach_hint()}
    </p>

    {#if signedIn}
      <label class="mt-3 flex items-start gap-2">
        <input
          type="checkbox"
          class="checkbox mt-0.5 checkbox-sm"
          bind:checked={named}
          aria-describedby="termi-feedback-named-hint"
        />
        <span class="text-sm">{m.termi_feedback_named()}</span>
      </label>
      <p id="termi-feedback-named-hint" class="mt-1 pl-7 text-xs text-base-content/70">
        {m.termi_feedback_named_hint()}
      </p>
    {/if}

    <p class="mt-4 text-xs text-base-content/70">
      {m.termi_feedback_closing()}
      {#if hasPrivacy}
        <a class="link" href={resolve('/privacy')} target="_blank" rel="noopener"
          >{m.navbar_privacy()}</a
        >
      {/if}
    </p>

    {#if failed}
      <p class="mt-3 text-sm text-error" role="alert">
        {m.termi_feedback_error()}
        {#if failed.named}{m.termi_feedback_error_named()}{/if}
      </p>
    {/if}

    <div class="modal-action">
      <button type="button" class="btn btn-ghost" disabled={sending} onclick={onclose}>
        {m.common_cancel()}
      </button>
      <button type="button" class="btn btn-primary" disabled={sending} onclick={send}>
        {#if sending}<span class="loading loading-xs loading-spinner"></span>{/if}
        {m.termi_feedback_send()}
      </button>
    </div>
  </div>
</div>
