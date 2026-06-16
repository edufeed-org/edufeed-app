<script>
  import HoverCard from '../shared/HoverCard.svelte';

  /** @type {{ enterDelay?: number, leaveDelay?: number, position?: 'top' | 'bottom', fixed?: boolean, onAction?: () => void }} */
  let {
    enterDelay = 150,
    leaveDelay = 300,
    position = 'bottom',
    fixed = false,
    onAction = () => {}
  } = $props();
</script>

<HoverCard {enterDelay} {leaveDelay} {position} {fixed}>
  {#snippet trigger()}
    <span data-testid="trigger">Hover me</span>
  {/snippet}
  {#snippet content()}
    <div data-testid="content">
      Card content
      <button type="button" data-testid="content-button" onclick={onAction}>Act</button>
    </div>
  {/snippet}
</HoverCard>
