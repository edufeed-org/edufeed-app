<script>
  // Calendar event; imported (bot) sources are de-emphasised.
  import * as m from '$lib/paraglide/messages';
  import { formatTimeOfDay, isoToGermanDate } from '$lib/helpers/dates.js';
  import { linkFor } from './links.js';

  /** @type {{ item: import('$lib/server/termi/items.js').Item }} */
  let { item } = $props();

  const open = $derived(linkFor(item));
  // nope-mcp sends unix seconds (time-based) or YYYY-MM-DD (date-based) as strings.
  const when = $derived.by(() => {
    const s = String(item.date ?? '');
    if (!/^\d+$/.test(s)) return isoToGermanDate(s);
    const sec = Number(s);
    // DD.MM.YYYY in every UI locale, like the ISO path (en-GB would give slashes).
    const day = new Date(sec * 1000).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    return item.allDay ? day : `${day}, ${formatTimeOfDay(sec)}`;
  });
  const meta = $derived([when, item.location].filter(Boolean).join(' · '));
</script>

<article
  data-testid="termi-card-event"
  class="min-w-0 rounded-xl border border-base-300 bg-base-100 px-3 py-2 {item.bot
    ? 'opacity-75'
    : ''}"
>
  <div data-testid="termi-card-title" class="line-clamp-2 text-[13px] leading-snug font-semibold">
    {item.title}
  </div>
  {#if meta}<div class="mt-0.5 truncate text-xs text-base-content/70">{meta}</div>{/if}
  {#if item.creator || item.bot}
    <div class="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-base-content/60">
      {#if item.bot}<span class="badge shrink-0 badge-ghost badge-sm"
          >{m.termi_card_imported()}</span
        >{/if}
      {#if item.creator}<span class="truncate">{item.creator}</span>{/if}
    </div>
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
</article>
