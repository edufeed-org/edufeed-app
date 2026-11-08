<script>
  // A citation: quoted text (3 lines, expandable) with its source and license.
  import * as m from '$lib/paraglide/messages';
  import { linkFor } from './links.js';

  /** @type {{ item: import('$lib/server/termi/items.js').Item }} */
  let { item } = $props();

  const open = $derived(linkFor(item));
  let expanded = $state(false);
  // shortcut: a length guess instead of measuring the clamp; jsdom can't measure either.
  const long = $derived((item.description?.length ?? 0) > 160);
  const by = $derived([item.publisher, item.license].filter(Boolean).join(' · '));
</script>

<article
  data-testid="termi-card-passage"
  class="min-w-0 rounded-xl border border-base-300 bg-base-100 px-3 py-2"
>
  {#if item.description}
    <blockquote
      class="border-l-2 border-base-300 pl-2 text-xs break-words text-base-content/80 italic {expanded
        ? ''
        : 'line-clamp-3'}"
    >
      {item.description}
    </blockquote>
  {/if}
  <div data-testid="termi-card-title" class="mt-1 truncate text-[13px] leading-snug font-semibold">
    {item.title}
  </div>
  {#if by}<div class="truncate text-[11px] text-base-content/60">{by}</div>{/if}
  {#if open || long}
    <div class="mt-1.5 flex flex-wrap gap-1.5">
      {#if open}
        <a href={open.href} target={open.target} rel={open.rel} class="btn btn-sm btn-primary">
          {m.termi_card_open_source()}
        </a>
      {/if}
      {#if long}
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          aria-expanded={expanded}
          onclick={() => (expanded = !expanded)}
        >
          {expanded ? m.termi_card_less() : m.termi_card_more()}
        </button>
      {/if}
    </div>
  {/if}
</article>
