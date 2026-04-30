<script>
  /** @type {any} */
  let { onPick } = $props();
</script>

<button type="button" data-testid="add-reaction-btn" onclick={() => onPick?.('🔥')}> + </button>
