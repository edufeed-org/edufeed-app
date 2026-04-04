<script>
  import HoverCard from '../shared/HoverCard.svelte';

  /** @type {{ enterDelay?: number, leaveDelay?: number, position?: 'top' | 'bottom' }} */
  let { enterDelay = 150, leaveDelay = 300, position = 'bottom' } = $props();
</script>

<HoverCard {enterDelay} {leaveDelay} {position}>
  {#snippet trigger()}
    <span data-testid="trigger">Hover me</span>
  {/snippet}
  {#snippet content()}
    <div data-testid="content">Card content</div>
  {/snippet}
</HoverCard>
