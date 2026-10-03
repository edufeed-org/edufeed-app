<!--
  CallLeaveConfirmModal — "Anruf verlassen?" before the user leaves a call
  (Task 19). Shown by ModalManager (type 'callLeaveConfirm', asked through
  `leaveGroupCallWithConfirm` in group-call.svelte.js), and mounted straight
  into the pop-out window by call-popout (the opener's modal layer is not
  visible there). Small-modal grammar: ghost cancel + error action, no
  native <dialog>. Escape and the backdrop cancel; listeners sit on the
  modal itself (not svelte:window) so they also work in the pop-out's own
  document.
-->
<script>
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {object} Props
   * @property {boolean} [guest] - joined through a call link (the way back)
   * @property {() => void} onConfirm
   * @property {() => void} onCancel
   */
  /** @type {Props} */
  let { guest = false, onConfirm, onCancel } = $props();

  /** @type {HTMLButtonElement | undefined} */
  let cancelEl = $state(undefined);
  $effect(() => {
    cancelEl?.focus();
  });

  /** @param {KeyboardEvent} event */
  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  }
</script>

<div
  class="modal-open modal"
  role="alertdialog"
  aria-modal="true"
  aria-labelledby="call-leave-confirm-title"
  tabindex="-1"
  data-testid="call-leave-confirm"
  onkeydown={onKeyDown}
>
  <div class="modal-box max-w-sm">
    <h3 id="call-leave-confirm-title" class="font-bold">
      {m.groups_call_leave_confirm_title()}
    </h3>
    <p class="py-2 text-sm">
      {guest ? m.groups_call_leave_confirm_body_guest() : m.groups_call_leave_confirm_body()}
    </p>
    <div class="modal-action">
      <button
        bind:this={cancelEl}
        class="btn btn-ghost"
        data-testid="call-leave-confirm-cancel"
        onclick={onCancel}
      >
        {m.common_cancel()}
      </button>
      <button class="btn btn-error" data-testid="call-leave-confirm-action" onclick={onConfirm}>
        {m.groups_call_leave_confirm_action()}
      </button>
    </div>
  </div>
  <button
    type="button"
    class="modal-backdrop"
    aria-label={m.common_cancel()}
    tabindex="-1"
    data-testid="call-leave-confirm-backdrop"
    onclick={onCancel}
  ></button>
</div>
