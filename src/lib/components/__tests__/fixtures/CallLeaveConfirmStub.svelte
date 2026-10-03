<script>
  /** Stand-in for CallLeaveConfirmModal: two buttons wired to the callbacks. */
  let { guest = false, onConfirm, onCancel } = $props();
</script>

<div data-testid="call-leave-confirm-stub" data-guest={guest}>
  <button type="button" data-testid="call-leave-confirm-stub-cancel" onclick={onCancel}>no</button>
  <button type="button" data-testid="call-leave-confirm-stub-confirm" onclick={onConfirm}
    >yes</button
  >
</div>
