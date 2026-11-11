<script>
  // A MEM curriculum hit: static (its w3id URI is an id, not a web page).
  import * as m from '$lib/paraglide/messages';

  /** @type {{ item: import('$lib/termi/items.d.js').Item }} */
  let { item } = $props();

  // MEM labels carry `<br>` breaks and `//…\\` emphasis markers.
  const title = $derived(
    String(item.title ?? '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/\/\/(.+?)\\{1,2}/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  );
</script>

<article
  data-testid="termi-card-curriculum"
  class="min-w-0 rounded-xl border border-base-300 bg-base-100 px-3 py-2"
>
  <div data-testid="termi-card-title" class="line-clamp-3 text-[13px] leading-snug font-semibold">
    {title}
  </div>
  {#if item.subtitle}
    <div class="mt-1 truncate text-[11px] text-base-content/60">{item.subtitle}</div>
  {/if}
  {#if item.curriculum}
    <div class="mt-0.5 line-clamp-2 text-xs text-base-content/70">
      {m.termi_card_curriculum({ title: item.curriculum })}
    </div>
  {/if}
  {#if item.parent}
    <div class="mt-0.5 line-clamp-2 text-xs text-base-content/50">{item.parent}</div>
  {/if}
</article>
