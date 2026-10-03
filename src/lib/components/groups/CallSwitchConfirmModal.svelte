<!--
  CallSwitchConfirmModal — "You're in a call in <title>. Switch?" Shown by
  ModalManager (type 'callSwitchConfirm') whenever `joinGroupCallWithConfirm`
  (group-call.svelte.js) finds the user still live in a different channel's
  call. Confirming leaves that call and joins the new one (joinGroupCall
  already leaves first); cancelling changes nothing. Small-modal grammar:
  ghost cancel + primary action, no native <dialog> (CSS-only, like
  GroupChat's own leave/delete confirms).
-->
<script>
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {object} Props
   * @property {string} title - the channel name of the call currently running
   * @property {() => void} onConfirm
   * @property {() => void} onCancel
   */
  /** @type {Props} */
  let { title, onConfirm, onCancel } = $props();
</script>

<div
  class="modal-open modal"
  role="alertdialog"
  aria-modal="true"
  aria-labelledby="call-switch-confirm-title"
  data-testid="call-switch-confirm"
>
  <div class="modal-box max-w-sm">
    <h3 id="call-switch-confirm-title" class="font-bold">
      {m.groups_call_switch_confirm_title()}
    </h3>
    <p class="py-2 text-sm">{m.groups_call_switch_confirm_body({ title })}</p>
    <div class="modal-action">
      <button class="btn btn-ghost" data-testid="call-switch-confirm-cancel" onclick={onCancel}>
        {m.common_cancel()}
      </button>
      <button class="btn btn-primary" data-testid="call-switch-confirm-action" onclick={onConfirm}>
        {m.groups_call_switch_confirm_action()}
      </button>
    </div>
  </div>
</div>
