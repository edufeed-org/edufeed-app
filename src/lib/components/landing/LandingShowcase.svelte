<script>
  // Three live panels under the landing hero (design 5b/5c): newest
  // materials, next Fortbildungen, newest articles — each tinted in the old
  // feature-card colour of its type. A quiet type disappears instead of
  // looking empty; Fortbildungen invite the visitor to add the first one.
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
  import { getUpcomingDateParts } from '$lib/helpers/dates.js';
  import { getTagValue } from 'applesauce-core/helpers';
  import { ArticleIcon, BookOpenIcon, CalendarIcon } from '$lib/components/icons';

  /** @typedef {'learning' | 'events' | 'articles'} PanelType */
  /** @typedef {'loading' | 'show' | 'hide'} PanelState */
  /**
   * @type {{
   *   materials: any[], events: any[], articles: any[],
   *   states: Record<PanelType, PanelState>,
   *   enabled: Record<PanelType, boolean>
   * }}
   */
  let { materials, events, articles, states, enabled } = $props();

  /** @param {any} event */
  const detailHref = (event) => resolve(`/${encodeEventToNaddr(event)}`);

  const panels = $derived(
    [
      {
        type: /** @type {PanelType} */ ('learning'),
        title: m.landing_panel_material(),
        all: m.landing_panel_material_all(),
        href: resolve('/discover?type=learning'),
        icon: BookOpenIcon,
        tint: 'bg-primary/10',
        badge: 'bg-primary text-primary-content',
        link: 'text-primary'
      },
      {
        type: /** @type {PanelType} */ ('events'),
        title: m.landing_panel_events(),
        all: m.landing_panel_events_all(),
        href: resolve('/calendar'),
        icon: CalendarIcon,
        tint: 'bg-secondary/10',
        badge: 'bg-secondary text-secondary-content',
        link: 'text-secondary'
      },
      {
        type: /** @type {PanelType} */ ('articles'),
        title: m.landing_panel_articles(),
        all: m.landing_panel_articles_all(),
        href: resolve('/discover?type=articles'),
        icon: ArticleIcon,
        tint: 'bg-accent/15',
        badge: 'bg-accent text-accent-content',
        link: 'text-base-content'
      }
    ].filter((p) => enabled[p.type] && (states[p.type] !== 'hide' || p.type === 'events'))
  );

  const row =
    'flex items-center gap-3 rounded-2xl bg-base-100 p-3 transition-shadow hover:shadow-md';
</script>

{#snippet materialRow(/** @type {any} */ item)}
  <a href={detailHref(item.rawEvent)} class={row}>
    <ImageWithFallback
      src={item.image || ''}
      alt=""
      fallbackType="generic"
      class="size-14 shrink-0 rounded-xl object-cover"
    />
    <span class="min-w-0">
      <span class="line-clamp-2 block leading-snug font-semibold">{item.name}</span>
      {#if item.license?.label}
        <span class="block text-sm text-base-content/70">{item.license.label}</span>
      {/if}
    </span>
  </a>
{/snippet}

{#snippet eventRow(/** @type {any} */ item)}
  {@const date = getUpcomingDateParts(item.start, item.kind)}
  <a href={detailHref(item.originalEvent)} class={row}>
    <span
      class="grid w-14 shrink-0 place-items-center rounded-xl bg-secondary/15 py-1.5 text-secondary"
    >
      <span class="text-xl leading-none font-bold">{date.day}</span>
      <span class="text-xs font-semibold uppercase">{date.month}</span>
    </span>
    <span class="min-w-0">
      <span class="line-clamp-2 block leading-snug font-semibold">{item.title}</span>
      <span class="block truncate text-sm text-base-content/70">
        {[date.time, item.location].filter(Boolean).join(' · ')}
      </span>
    </span>
  </a>
{/snippet}

{#snippet articleRow(/** @type {any} */ item)}
  <a href={detailHref(item)} class={row}>
    <span class="min-w-0">
      <span class="line-clamp-2 block leading-snug font-semibold">
        {getTagValue(item, 'title')}
      </span>
      {#if getTagValue(item, 'summary')}
        <span class="line-clamp-1 block text-sm text-base-content/70">
          {getTagValue(item, 'summary')}
        </span>
      {/if}
    </span>
  </a>
{/snippet}

{#if panels.length > 0}
  <section data-testid="landing-showcase" class="container mx-auto px-4 py-10">
    <div class="grid gap-6 lg:grid-cols-3">
      {#each panels as panel (panel.type)}
        {@const Icon = panel.icon}
        <div
          data-testid="landing-panel-{panel.type}"
          class="flex flex-col gap-3 rounded-3xl p-5 {panel.tint}"
        >
          <h2 class="flex items-center gap-2.5 text-lg font-semibold">
            <span class="grid size-9 shrink-0 place-items-center rounded-full {panel.badge}">
              <Icon class_="h-5 w-5" />
            </span>
            {panel.title}
          </h2>

          {#if states[panel.type] === 'loading'}
            {#each [0, 1, 2] as i (i)}
              <div class="h-20 skeleton rounded-2xl"></div>
            {/each}
          {:else if states[panel.type] === 'hide'}
            <div
              data-testid="landing-events-empty"
              class="flex flex-col items-start gap-2 rounded-2xl border-2 border-dashed border-base-300 p-4"
            >
              <p class="font-semibold">{m.landing_panel_events_empty_title()}</p>
              <p class="text-sm text-base-content/70">{m.landing_panel_events_empty_body()}</p>
              <button
                type="button"
                data-testid="landing-events-empty-cta"
                class="btn btn-outline btn-sm"
                onclick={() => modalStore.openModal('signup')}
              >
                {m.landing_panel_events_empty_cta()}
              </button>
            </div>
          {:else}
            {#if panel.type === 'learning'}
              {#each materials as item (item.id)}{@render materialRow(item)}{/each}
            {:else if panel.type === 'events'}
              {#each events as item (item.id)}{@render eventRow(item)}{/each}
            {:else}
              {#each articles as item (item.id)}{@render articleRow(item)}{/each}
            {/if}
            <a
              data-testid="landing-panel-{panel.type}-all"
              href={panel.href}
              class="mt-1 inline-flex items-center gap-1 font-semibold {panel.link}"
            >
              {panel.all} →
            </a>
          {/if}
        </div>
      {/each}
    </div>
  </section>
{/if}
