<!--
  ExpandableListCard — Reusable expandable card for NIP-51 list items.
  Renders card chrome (icon, title, count, expand arrow) with slot for expanded content.
-->
<script>
  /** @type {{ title: string, count: number, countLabel?: string, expanded: boolean, toggle: () => void, icon?: import('svelte').Snippet, children?: import('svelte').Snippet }} */
  let { title, count, countLabel = 'items', expanded, toggle, icon, children } = $props();
</script>

<button
  class="w-full rounded-lg border border-base-300 bg-base-100 p-4 text-left shadow-sm transition-shadow hover:shadow-md"
  onclick={toggle}
>
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-3">
      {#if icon}
        {@render icon()}
      {/if}
      <div>
        <span class="font-medium">{title}</span>
        <span class="ml-2 text-sm text-base-content/50">{count} {countLabel}</span>
      </div>
    </div>
    <span class="text-base-content/40">{expanded ? '▲' : '▼'}</span>
  </div>
</button>
{#if expanded && children}
  <div class="ml-4 py-2">
    {@render children()}
  </div>
{/if}
