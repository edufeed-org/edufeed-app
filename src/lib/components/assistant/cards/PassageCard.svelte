<script>
  // A citation: title, source and license, then the quoted text (3 lines, expandable).
  import * as m from '$lib/paraglide/messages';
  import { linkFor } from './links.js';
  import { clampQuote } from './quote.js';

  /** @type {{ item: import('$lib/server/termi/items.js').Item }} */
  let { item } = $props();

  const open = $derived(linkFor(item));
  let expanded = $state(false);
  // shortcut: a length guess instead of measuring the clamp; jsdom can't measure either.
  const quote = $derived(clampQuote(item.description));
  const long = $derived(quote.length > 160);
  const by = $derived([item.publisher, item.license].filter(Boolean).join(' · '));
</script>

<article
  data-testid="termi-card-passage"
  class="min-w-0 rounded-xl border border-base-300 bg-base-100 px-3 py-2"
>
  <div
    data-testid="termi-card-title"
    class="line-clamp-2 text-[13px] leading-snug font-semibold break-words"
  >
    {item.title}
  </div>
  {#if by}<div class="truncate text-[11px] text-base-content/60">{by}</div>{/if}
  {#if quote}
    <blockquote
      class="mt-1 border-l-2 border-base-300 pl-2 text-xs break-words text-base-content/80 italic {expanded
        ? ''
        : 'line-clamp-3'}"
    >
      {quote}
    </blockquote>
  {/if}
  {#if open || long}
    <div class="mt-1.5 flex flex-wrap gap-1.5">
      {#if open}
        <a
          href={open.href}
          target={open.target}
          rel={open.rel}
          class="btn btn-sm btn-primary"
          aria-label="{m.termi_card_open_source()}: {item.title}"
        >
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
