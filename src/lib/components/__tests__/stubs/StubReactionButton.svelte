<script>
  /** @type {any} */
  let { emoji, count, userReacted, onToggle } = $props();
</script>

<button
  type="button"
  onclick={() => onToggle?.()}
  data-testid="reaction-button"
  data-emoji={emoji}
  data-count={count}
  data-user-reacted={userReacted}
>
  <span>{emoji}</span>
  <span>{count}</span>
</button>
