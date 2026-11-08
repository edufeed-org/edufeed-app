<script>
  import * as m from '$lib/paraglide/messages';
  import { getProxiedImageUrl } from '$lib/helpers/image-proxy.js';
  import { externalLink, linkFor } from './links.js';

  /** @type {{ item: import('$lib/server/termi/items.js').Item }} */
  let { item } = $props();

  const open = $derived(linkFor(item));
  const picture = $derived(getProxiedImageUrl(externalLink(item.picture)?.href, 'avatar_sm'));
</script>

<article
  data-testid="termi-card-community"
  class="flex min-w-0 gap-2.5 rounded-xl border border-base-300 bg-base-100 px-3 py-2"
>
  {#if picture}
    <img src={picture} alt="" loading="lazy" class="h-10 w-10 shrink-0 rounded-lg object-cover" />
  {/if}
  <div class="min-w-0 flex-1">
    <div data-testid="termi-card-title" class="truncate text-[13px] leading-snug font-semibold">
      {item.title}
    </div>
    {#if item.description}
      <div class="truncate text-xs text-base-content/70">{item.description}</div>
    {/if}
    {#if open}
      <div class="mt-1.5 flex flex-wrap gap-1.5">
        <a
          href={open.href}
          target={open.target}
          rel={open.rel}
          class="btn btn-sm btn-primary"
          aria-label="{m.termi_card_open()}: {item.title}"
        >
          {m.termi_card_open()}
        </a>
      </div>
    {/if}
  </div>
</article>
