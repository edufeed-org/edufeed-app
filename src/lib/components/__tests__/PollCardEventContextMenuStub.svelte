<script>
  // Test-only stub for EventContextMenu. Exposes onDelete + delete labels via
  // a single button so PollCard tests can assert delete wiring without
  // pulling in the full menu's pin/share/clipboard dependency chain.
  // Confirm-modal flow is covered in EventContextMenu's own tests.
  let { onDelete = undefined, deleteTitle = '', deleteItemName = '' } = $props();
</script>

{#if onDelete}
  <button
    type="button"
    data-testid="poll-delete-trigger"
    data-delete-title={deleteTitle}
    data-delete-item-name={deleteItemName}
    onclick={() => onDelete?.()}
  >
    Delete poll
  </button>
{/if}
