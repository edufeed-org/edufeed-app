<script>
  import HoverCard from '../shared/HoverCard.svelte';
  import HoverCardHoldContent from './HoverCardHoldContent.svelte';

  /** @type {{ promise: Promise<unknown>, fixed?: boolean }} */
  let { promise, fixed = false } = $props();
</script>

<HoverCard enterDelay={0} leaveDelay={10} {fixed}>
  {#snippet trigger()}
    <span data-testid="trigger">Hover me</span>
  {/snippet}
  {#snippet content()}
    <div data-testid="content">
      <HoverCardHoldContent {promise} />
    </div>
  {/snippet}
</HoverCard>
