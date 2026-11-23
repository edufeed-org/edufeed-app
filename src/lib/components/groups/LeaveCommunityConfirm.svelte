<!--
  Confirm before leaving a moderated community (issue c379c8ff): the leave
  request also takes me out of every channel, and the way back into a closed
  one is a new invitation. Same text as the channel menu's "Leave community".
-->
<script>
  import * as m from '$lib/paraglide/messages';

  /** @type {{busy?: boolean, onConfirm: () => void, onCancel: () => void}} */
  let { busy = false, onConfirm, onCancel } = $props();
</script>

<div class="modal-open modal" role="dialog" data-testid="community-leave-confirm">
  <div class="modal-box max-w-sm">
    <h3 class="font-bold">{m.groups_leave_community_confirm_title()}</h3>
    <p class="py-2 text-sm opacity-70">{m.groups_leave_community_confirm_body()}</p>
    <div class="modal-action">
      <button class="btn btn-ghost" onclick={onCancel}>{m.common_cancel()}</button>
      <button
        class="btn btn-error"
        data-testid="community-leave-confirm-action"
        disabled={busy}
        onclick={onConfirm}
      >
        {m.groups_leave_community()}
      </button>
    </div>
  </div>
</div>
