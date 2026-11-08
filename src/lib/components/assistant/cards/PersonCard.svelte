<script>
  // A person; name-only people (no npub match) keep just "Material von …".
  import * as m from '$lib/paraglide/messages';
  import { externalLink, linkFor } from './links.js';

  /** @type {{ item: import('$lib/server/termi/items.js').Item, onSearchAuthor?: (item: import('$lib/server/termi/items.js').Item) => void }} */
  let { item, onSearchAuthor } = $props();

  const open = $derived(linkFor(item));
  const picture = $derived(externalLink(item.picture)?.href);
</script>

<article
  data-testid="termi-card-person"
  class="flex min-w-0 gap-2.5 rounded-xl border border-base-300 bg-base-100 px-3 py-2"
>
  {#if picture}
    <img src={picture} alt="" loading="lazy" class="h-10 w-10 shrink-0 rounded-full object-cover" />
  {/if}
  <div class="min-w-0 flex-1">
    <div data-testid="termi-card-title" class="truncate text-[13px] leading-snug font-semibold">
      {item.title}
    </div>
    {#if item.subtitle}
      <div class="truncate text-[11px] text-base-content/60">{item.subtitle}</div>
    {/if}
    {#if item.description}
      <div class="truncate text-xs text-base-content/70">{item.description}</div>
    {/if}
    {#if open || onSearchAuthor}
      <div class="mt-1.5 flex flex-wrap gap-1.5">
        {#if open}
          <a href={open.href} target={open.target} rel={open.rel} class="btn btn-sm btn-primary">
            {m.termi_card_profile()}
          </a>
        {/if}
        {#if onSearchAuthor}
          <button
            type="button"
            class="btn max-w-full btn-ghost btn-sm"
            onclick={() => onSearchAuthor(item)}
          >
            <span class="min-w-0 truncate">{m.termi_card_author_search({ name: item.title })}</span>
          </button>
        {/if}
      </div>
    {/if}
  </div>
</article>
