<script>
  // Test-only stub for EventContextMenu: marks where the ⋯ menu sits and
  // exposes onEdit / onDelete as plain buttons, without the real menu's
  // pin/share/clipboard dependency chain (covered by its own tests).
  let { event, onEdit = undefined, onDelete = undefined } = $props();
</script>

<div data-testid="event-context-menu" data-event-id={event?.id}>
  {#if onEdit}
    <button type="button" data-testid="menu-edit" onclick={() => onEdit?.()}>Edit</button>
  {/if}
  {#if onDelete}
    <button type="button" data-testid="menu-delete" onclick={() => onDelete?.()}>Delete</button>
  {/if}
</div>
