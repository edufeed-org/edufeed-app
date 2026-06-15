<script>
  // Test double for DetailHeader: surfaces the action handlers as buttons so a
  // parent component test can assert whether edit/delete were wired up.
  let { onEdit = undefined, onDelete = undefined } = $props();
</script>

{#if onEdit}
  <button data-testid="edit-action" onclick={() => onEdit()}>edit</button>
{/if}
{#if onDelete}
  <button data-testid="delete-action" onclick={() => onDelete()}>delete</button>
{/if}
