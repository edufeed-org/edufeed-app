<!--
  Shared editorial empty state: paper card with a dashed rule (same look as
  the profile tabs' pf-empty). Use everywhere a list/feed has nothing to show
  so empty surfaces read the same across the app.
-->
<script>
  /**
   * @type {{
   *   title?: string,
   *   description?: string,
   *   iconPath?: string,
   *   icon?: import('svelte').Snippet,
   *   testid?: string
   * }}
   */
  let {
    title = '',
    description = '',
    iconPath = '',
    icon = undefined,
    testid = 'empty-state'
  } = $props();
</script>

<div class="empty-state" data-testid={testid}>
  {#if icon}
    {@render icon()}
  {:else if iconPath}
    <svg
      xmlns="http://www.w3.org/2000/svg"
      class="h-10 w-10"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={iconPath} />
    </svg>
  {/if}
  {#if title}<h3>{title}</h3>{/if}
  {#if description}<p>{description}</p>{/if}
</div>

<style>
  .empty-state {
    background: var(--c-paper);
    border: 1.5px dashed var(--c-rule);
    border-radius: 14px;
    padding: 40px 24px;
    text-align: center;
    color: var(--c-ink-soft);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .empty-state h3 {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 16px;
    color: var(--c-ink);
    margin: 0;
  }
  .empty-state p {
    margin: 0;
    font-size: 14px;
    max-width: 420px;
  }
</style>
