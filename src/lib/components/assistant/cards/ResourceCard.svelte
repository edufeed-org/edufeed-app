<script>
  // Resource / article / wiki / project / publication: subtitle names the kind.
  import * as m from '$lib/paraglide/messages';
  import { externalLink, linkFor } from './links.js';

  /** @type {{ item: import('$lib/server/termi/items.js').Item }} */
  let { item } = $props();

  const open = $derived(linkFor(item));
  // "Quelle" only when it differs from the primary link.
  const source = $derived(open?.href === item.sourceUrl ? undefined : externalLink(item.sourceUrl));
  const by = $derived([item.creator, item.publisher].filter(Boolean).join(' · '));
</script>

<article
  data-testid="termi-card-resource"
  class="min-w-0 rounded-xl border border-base-300 bg-base-100 px-3 py-2"
>
  <div data-testid="termi-card-title" class="line-clamp-2 text-[13px] leading-snug font-semibold">
    {item.title}
  </div>
  {#if item.subtitle || item.license}
    <div class="mt-1 flex min-w-0 flex-wrap gap-1">
      {#if item.subtitle}<span class="badge max-w-full truncate badge-ghost badge-sm"
          >{item.subtitle}</span
        >{/if}
      {#if item.license}<span class="badge max-w-full truncate badge-outline badge-sm"
          >{item.license}</span
        >{/if}
    </div>
  {/if}
  {#if by}<div class="mt-1 truncate text-[11px] text-base-content/60">{by}</div>{/if}
  {#if item.description}
    <div class="mt-0.5 line-clamp-2 text-xs text-base-content/70">{item.description}</div>
  {/if}
  {#if open || source}
    <div class="mt-1.5 flex flex-wrap gap-1.5">
      {#if open}
        <a href={open.href} target={open.target} rel={open.rel} class="btn btn-sm btn-primary">
          {m.termi_card_open()}
        </a>
      {/if}
      {#if source}
        <a href={source.href} target={source.target} rel={source.rel} class="btn btn-ghost btn-sm">
          {m.termi_card_source()}
        </a>
      {/if}
    </div>
  {/if}
</article>
