<!--
  ExpandableListCard — Reusable expandable card for NIP-51 list items.
  Accent icon tile, count pill, rotating chevron; slot for expanded content.
-->
<script>
  import { ChevronDownIcon } from '$lib/components/icons';

  /** @type {{ title: string, count: number, countLabel?: string, expanded: boolean, toggle: () => void, accent?: string, icon?: import('svelte').Snippet, children?: import('svelte').Snippet }} */
  let {
    title,
    count,
    countLabel = 'items',
    expanded,
    toggle,
    accent = 'var(--color-primary)',
    icon,
    children
  } = $props();
</script>

<div
  class="overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-sm transition-shadow hover:shadow-md"
>
  <button
    class="flex w-full items-center gap-3 p-3.5 text-left"
    onclick={toggle}
    aria-expanded={expanded}
  >
    {#if icon}
      <span
        class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
        style="color: {accent}; background: color-mix(in oklch, {accent} 14%, transparent)"
      >
        {@render icon()}
      </span>
    {/if}
    <div class="min-w-0 flex-1">
      <span class="block truncate font-medium">{title}</span>
    </div>
    <span
      class="rounded-full bg-base-200 px-2 py-0.5 text-xs font-medium text-base-content/60 tabular-nums"
    >
      {count}
      {countLabel}
    </span>
    <ChevronDownIcon
      class_="h-4 w-4 text-base-content/40 transition-transform duration-200 {expanded
        ? 'rotate-180'
        : ''}"
    />
  </button>
  {#if expanded && children}
    <div class="border-t border-base-300 px-4 py-3">
      {@render children()}
    </div>
  {/if}
</div>
