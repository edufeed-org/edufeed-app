<!-- Captures the props ChannelChat.svelte (and, in principle, any other
     caller) passes to the real ReactionChips, and exposes clickable
     stand-ins to invoke onToggle/onPick from a test. Encodes `aggregated`
     as JSON on a data attribute since Testing Library can only assert on
     DOM, not component internals. -->
<script>
  let { aggregated, addButtonOnHover = false, onToggle, onPick } = $props();

  let serializable = $derived(
    [...aggregated.entries()].map(([emoji, summary]) => [emoji, summary])
  );
</script>

<div
  data-testid="reaction-chips-stub"
  data-add-button-on-hover={addButtonOnHover}
  data-aggregated={JSON.stringify(serializable)}
>
  {#each serializable as [emoji, summary] (emoji)}
    <button data-testid="chip-stub-{emoji}" onclick={() => onToggle?.(emoji, summary)}>
      {emoji}
    </button>
  {/each}
  <button data-testid="pick-stub" onclick={() => onPick?.('😀')}>+</button>
</div>
