<script>
  import HoverCard from '../shared/HoverCard.svelte';

  /**
   * @type {{
   *   enterDelay?: number,
   *   leaveDelay?: number,
   *   position?: 'top' | 'bottom',
   *   fixed?: boolean,
   *   onAction?: () => void,
   *   interactiveTrigger?: boolean
   * }}
   */
  let {
    enterDelay = 150,
    leaveDelay = 300,
    position = 'bottom',
    fixed = false,
    onAction = () => {},
    interactiveTrigger = false
  } = $props();
</script>

<HoverCard {enterDelay} {leaveDelay} {position} {fixed} {interactiveTrigger}>
  {#snippet trigger()}
    {#if interactiveTrigger}
      <a href="#profile" data-testid="trigger">Hover me</a>
    {:else}
      <span data-testid="trigger">Hover me</span>
    {/if}
  {/snippet}
  {#snippet content()}
    <div data-testid="content">
      Card content
      <button type="button" data-testid="content-button" onclick={onAction}>Act</button>
    </div>
  {/snippet}
</HoverCard>
