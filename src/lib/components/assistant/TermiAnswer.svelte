<script>
  // A router answer: Termi's line plus destination buttons (links or actions).
  /** @type {{ text: string, actions?: import('./termi-router.js').TermiAction[] }} */
  let { text, actions = [] } = $props();
</script>

{text}
{#if actions.length > 0}
  <div class="mt-2 flex flex-wrap gap-2" data-testid="termi-answer-actions">
    {#each actions as action, i (i)}
      {#if action.href}
        <a
          href={action.href}
          target={action.target}
          rel={action.rel}
          class="btn btn-sm btn-primary"
        >
          {action.label}
        </a>
      {:else}
        <button type="button" class="btn btn-sm btn-primary" onclick={action.run}>
          {action.label}
        </button>
      {/if}
    {/each}
  </div>
{/if}
