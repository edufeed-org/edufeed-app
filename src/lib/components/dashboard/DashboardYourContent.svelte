<!--
  DashboardYourContent — the logged-in user's created content ("Eigene Inhalte").

  Three density views (Regale / Raster / Liste). The create affordance is always
  present: a per-shelf "+ Typ" tile, an inline create row in list view, and a
  full empty hub when there is nothing yet — so the CTA never vanishes once the
  user has content (the core problem the redesign fixes).
-->

<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import { TimelineModel } from 'applesauce-core/models';
  import { timedPool } from '$lib/loaders/base.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import {
    getCalendarRelays,
    getEducationalRelays,
    getArticleRelays,
    getAllLookupRelays
  } from '$lib/helpers/relay-helper.js';
  import { getPollRelays } from '$lib/loaders/polls.js';
  import { getWriteRelays } from '$lib/services/relay-service.svelte.js';
  import { getContentEventRoute } from '$lib/helpers/contentNavigation.js';
  import { getFeedCardData } from '$lib/helpers/feedCardData.js';
  import { navigateToCreate } from '$lib/helpers/contentCreation.js';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import OwnerCardStats from './OwnerCardStats.svelte';
  import {
    SHELF_ORDER,
    ALL_CONTENT_KINDS,
    getContentType,
    groupItemsByType
  } from '$lib/helpers/myContentTypes.js';
  import {
    CalendarIcon,
    GraduationCapIcon,
    BookIcon,
    ScrollTextIcon,
    FilesIcon,
    PollIcon,
    BookmarkIcon,
    GlobeIcon,
    PlusIcon
  } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ pubkey: string }} */
  let { pubkey } = $props();

  /**
   * Per-type render metadata. The accent color lives in the pure registry
   * (myContentTypes.js); icon + label belong to the render layer.
   * @type {Record<string, { icon: any, label: () => string, cta: () => string }>}
   */
  const TYPE_UI = {
    calendar: {
      icon: CalendarIcon,
      label: () => m.feed_badge_calendar(),
      cta: () => m.fab_create_event()
    },
    learning: {
      icon: GraduationCapIcon,
      label: () => m.feed_badge_learning(),
      cta: () => m.fab_create_learning()
    },
    article: {
      icon: ScrollTextIcon,
      label: () => m.feed_badge_article(),
      cta: () => m.article_fab_write()
    },
    wiki: { icon: BookIcon, label: () => m.feed_badge_wiki(), cta: () => m.wiki_fab_write() },
    form: {
      icon: FilesIcon,
      label: () => m.dashboard_content_forms(),
      cta: () => m.fab_create_form()
    },
    poll: {
      icon: PollIcon,
      label: () => m.dashboard_content_polls(),
      cta: () => m.fab_create_poll()
    },
    bookmark: {
      icon: BookmarkIcon,
      label: () => m.feed_badge_bookmark(),
      cta: () => m.fab_add_bookmark()
    }
  };

  /** @type {'shelves' | 'grid' | 'list'} */
  let view = $state('shelves');
  let activeFilter = $state('all');
  let items = $state.raw(/** @type {any[]} */ ([]));
  let isLoading = $state(true);

  let grouped = $derived(groupItemsByType(items));

  let filteredItems = $derived.by(() => {
    if (activeFilter === 'all') return items;
    return grouped[activeFilter] ?? [];
  });

  // Types that actually have content — drives the filter chip row.
  let presentTypes = $derived(SHELF_ORDER.filter((k) => (grouped[k]?.length ?? 0) > 0));

  // In a specific filter, show only that shelf; in "all", show every shelf
  // (empty ones surface a create tile instead of disappearing).
  let shelvesToShow = $derived(activeFilter === 'all' ? SHELF_ORDER : [activeFilter]);

  $effect(() => {
    if (!pubkey) {
      isLoading = false;
      return;
    }

    items = [];
    isLoading = true;

    let cancelled = false;
    /** @type {import('rxjs').Subscription[]} */
    const subs = [];

    // The user's own content (esp. bookmarks/wiki/forms with no dedicated app
    // relay) often lives only on their NIP-65 write relays. Query those too so
    // "Meine Inhalte" is complete on a cold event store, not just when warmed
    // by another view.
    getWriteRelays(pubkey).then((writeRelays) => {
      if (cancelled || writeRelays.length === 0) return;
      const filter = { kinds: ALL_CONTENT_KINDS, authors: [pubkey], limit: 100 };
      const loader = createTimelineLoader(timedPool, writeRelays, filter, { eventStore });
      subs.push(
        loader().subscribe({
          error: (err) => console.error('DashboardYourContent: write-relay loader error:', err)
        })
      );
    });

    const relayGroups = [
      { relays: getCalendarRelays(), kinds: [31922, 31923] },
      { relays: getEducationalRelays(), kinds: [30142] },
      { relays: getArticleRelays(), kinds: [30023] },
      { relays: getAllLookupRelays(), kinds: [30818, 30168, 39701] },
      { relays: getPollRelays(), kinds: [1068] }
    ];

    for (const { relays, kinds } of relayGroups) {
      if (relays.length === 0) continue;
      const filter = { kinds, authors: [pubkey], limit: 50 };
      const loader = createTimelineLoader(timedPool, relays, filter, { eventStore });
      subs.push(
        loader().subscribe({
          error: (err) => console.error('DashboardYourContent: Loader error:', err)
        })
      );
    }

    const modelSub = eventStore
      .model(TimelineModel, { kinds: ALL_CONTENT_KINDS, authors: [pubkey] })
      .subscribe({
        next: (loaded) => {
          items = loaded || [];
          isLoading = false;
        }
      });
    subs.push(modelSub);

    return () => {
      cancelled = true;
      subs.forEach((s) => s.unsubscribe());
    };
  });

  /** @param {any} event */
  function navigateToEvent(event) {
    const route = getContentEventRoute(event);
    if (route) goto(resolve(/** @type {any} */ (route)));
  }

  /** @param {string} key */
  function accentOf(key) {
    return getContentType(key)?.accent ?? 'var(--color-base-content)';
  }
</script>

{#snippet pubGlobe()}
  <svg
    class="myc-globe"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18" />
  </svg>
{/snippet}

<section data-testid="dashboard-your-content" class="myc">
  <!-- Toolbar: filter chips + density toggle -->
  <div class="myc-toolbar">
    <div class="myc-filters" role="tablist" aria-label={m.dashboard_content_title()}>
      <button
        class="myc-chip"
        class:myc-chip-active={activeFilter === 'all'}
        role="tab"
        aria-selected={activeFilter === 'all'}
        onclick={() => (activeFilter = 'all')}
      >
        {m.common_all()}
        <span class="myc-chip-count">{items.length}</span>
      </button>
      {#each presentTypes as key (key)}
        <button
          class="myc-chip"
          class:myc-chip-active={activeFilter === key}
          role="tab"
          aria-selected={activeFilter === key}
          style="--ac: {accentOf(key)}"
          onclick={() => (activeFilter = key)}
        >
          <span class="myc-dot"></span>
          {TYPE_UI[key].label()}
          <span class="myc-chip-count">{grouped[key].length}</span>
        </button>
      {/each}
    </div>

    <div class="myc-views join" role="group" aria-label="View">
      <button
        class="btn join-item btn-sm"
        class:btn-active={view === 'shelves'}
        aria-pressed={view === 'shelves'}
        title={m.mycontent_view_shelves()}
        onclick={() => (view = 'shelves')}
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="5" rx="1" /><rect
            x="3"
            y="11"
            width="18"
            height="5"
            rx="1"
          /><line x1="6" y1="18" x2="18" y2="18" />
        </svg>
        <span class="sr-only">{m.mycontent_view_shelves()}</span>
      </button>
      <button
        class="btn join-item btn-sm"
        class:btn-active={view === 'grid'}
        aria-pressed={view === 'grid'}
        title={m.mycontent_view_grid()}
        onclick={() => (view = 'grid')}
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" /><rect
            x="14"
            y="3"
            width="7"
            height="7"
            rx="1"
          /><rect x="3" y="14" width="7" height="7" rx="1" /><rect
            x="14"
            y="14"
            width="7"
            height="7"
            rx="1"
          />
        </svg>
        <span class="sr-only">{m.mycontent_view_grid()}</span>
      </button>
      <button
        class="btn join-item btn-sm"
        class:btn-active={view === 'list'}
        aria-pressed={view === 'list'}
        title={m.mycontent_view_list()}
        onclick={() => (view = 'list')}
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line
            x1="8"
            y1="18"
            x2="21"
            y2="18"
          /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line
            x1="3"
            y1="18"
            x2="3.01"
            y2="18"
          />
        </svg>
        <span class="sr-only">{m.mycontent_view_list()}</span>
      </button>
    </div>
  </div>

  {#if isLoading}
    <div class="flex justify-center py-12">
      <span class="loading loading-md loading-spinner text-primary"></span>
    </div>
  {:else if items.length === 0}
    <!-- Empty hub: one create tile per type, CTA never vanishes -->
    <div class="myc-hub">
      <p class="myc-hub-eyebrow">{m.mycontent_empty_eyebrow()}</p>
      <h3 class="myc-hub-title">{m.mycontent_empty_title()}</h3>
      <p class="myc-hub-body">{m.mycontent_empty_body()}</p>
      <div class="myc-hub-grid">
        {#each SHELF_ORDER as key (key)}
          {@const Icon = TYPE_UI[key].icon}
          <button
            class="myc-hub-tile"
            style="--ac: {accentOf(key)}"
            onclick={() => navigateToCreate(key)}
          >
            <span class="myc-hub-tile-icon"><Icon class_="h-5 w-5" /></span>
            <span class="myc-hub-tile-label">{TYPE_UI[key].label()}</span>
            <PlusIcon class_="myc-hub-tile-plus h-4 w-4" />
          </button>
        {/each}
      </div>
    </div>
  {:else if view === 'shelves'}
    <div class="myc-shelves">
      {#each shelvesToShow as key (key)}
        {@const Icon = TYPE_UI[key].icon}
        {@const shelfItems = grouped[key] ?? []}
        <div class="myc-shelf" style="--ac: {accentOf(key)}">
          <div class="myc-shelf-head">
            <span class="myc-shelf-icon"><Icon class_="h-4 w-4" /></span>
            <span class="myc-shelf-label">{TYPE_UI[key].label()}</span>
            <span class="myc-shelf-count">{shelfItems.length}</span>
            <span class="myc-shelf-rule"></span>
            <button class="myc-shelf-add" onclick={() => navigateToCreate(key)}>
              <PlusIcon class_="h-3.5 w-3.5" />
              {TYPE_UI[key].cta()}
            </button>
          </div>

          {#if shelfItems.length === 0}
            <button class="myc-empty-tile" onclick={() => navigateToCreate(key)}>
              <PlusIcon class_="h-4 w-4" />
              {TYPE_UI[key].cta()}
            </button>
          {:else}
            <div class="myc-card-grid">
              {#each shelfItems as event (event.id)}
                {@const card = getFeedCardData(event)}
                <button class="myc-card" onclick={() => navigateToEvent(event)}>
                  <span class="myc-card-tag">{TYPE_UI[key].label()}</span>
                  <h4 class="myc-card-title">{card.title}</h4>
                  {#if card.description}<p class="myc-card-desc">{card.description}</p>{/if}
                  <div class="myc-card-foot">
                    {@render pubGlobe()}
                    <span>{m.mycontent_status_published()}</span>
                    <span class="myc-card-dot">·</span>
                    <span>{formatRelativeTime(event.created_at)}</span>
                    <OwnerCardStats {event} />
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {:else if view === 'grid'}
    <div class="myc-card-grid">
      {#each filteredItems as event (event.id)}
        {@const card = getFeedCardData(event)}
        {@const key = card.typeKey}
        <button
          class="myc-card"
          style="--ac: {accentOf(key)}"
          onclick={() => navigateToEvent(event)}
        >
          <span class="myc-card-tag">{TYPE_UI[key]?.label() ?? key}</span>
          <h4 class="myc-card-title">{card.title}</h4>
          {#if card.description}<p class="myc-card-desc">{card.description}</p>{/if}
          <div class="myc-card-foot">
            {@render pubGlobe()}
            <span>{m.mycontent_status_published()}</span>
            <span class="myc-card-dot">·</span>
            <span>{formatRelativeTime(event.created_at)}</span>
            <OwnerCardStats {event} />
          </div>
        </button>
      {/each}
      {#if activeFilter !== 'all'}
        <button
          class="myc-empty-tile myc-empty-tile-tall"
          style="--ac: {accentOf(activeFilter)}"
          onclick={() => navigateToCreate(activeFilter)}
        >
          <PlusIcon class_="h-5 w-5" />
          {TYPE_UI[activeFilter]?.cta() ?? m.mycontent_create_new()}
        </button>
      {/if}
    </div>
  {:else}
    <!-- list view -->
    <div class="myc-list">
      {#each filteredItems as event (event.id)}
        {@const card = getFeedCardData(event)}
        {@const key = card.typeKey}
        {@const Icon = TYPE_UI[key]?.icon ?? GlobeIcon}
        <button
          class="myc-row"
          style="--ac: {accentOf(key)}"
          onclick={() => navigateToEvent(event)}
        >
          <span class="myc-row-icon"><Icon class_="h-4 w-4" /></span>
          <span class="myc-row-main">
            <span class="myc-row-title">{card.title}</span>
            <span class="myc-row-meta"
              >{TYPE_UI[key]?.label() ?? key} · {formatRelativeTime(event.created_at)}</span
            >
          </span>
          <span class="myc-row-status">
            {@render pubGlobe()}
            {m.mycontent_status_published()}
            <OwnerCardStats {event} />
          </span>
        </button>
      {/each}
      <button
        class="myc-row myc-row-create"
        onclick={() => navigateToCreate(activeFilter === 'all' ? SHELF_ORDER[0] : activeFilter)}
      >
        <span class="myc-row-icon"><PlusIcon class_="h-4 w-4" /></span>
        <span class="myc-row-main">
          <span class="myc-row-title">{m.mycontent_create_row()}</span>
        </span>
      </button>
    </div>
  {/if}
</section>

<style>
  /* Density toolbar */
  .myc-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
    flex-wrap: wrap;
  }
  .myc-filters {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
    scrollbar-width: none;
    padding-bottom: 2px;
  }
  .myc-filters::-webkit-scrollbar {
    display: none;
  }
  .myc-chip {
    display: inline-flex;
    align-items: baseline;
    gap: 0.4rem;
    white-space: nowrap;
    padding: 0.35rem 0.7rem;
    border-radius: 999px;
    border: 1px solid var(--color-base-300);
    background: var(--color-base-100);
    color: var(--color-base-content);
    font-size: 0.8125rem;
    line-height: 1.1;
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s;
  }
  .myc-chip:hover {
    border-color: color-mix(in oklch, var(--color-base-content) 25%, transparent);
  }
  .myc-chip-active {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-primary-content);
  }
  .myc-dot {
    align-self: center;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--ac);
  }
  .myc-chip-count {
    font-variant-numeric: tabular-nums;
    font-size: 0.6875rem;
    opacity: 0.7;
  }

  /* Shelves */
  .myc-shelves {
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
  }
  .myc-shelf-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .myc-shelf-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.5rem;
    color: var(--ac);
    background: color-mix(in oklch, var(--ac) 14%, transparent);
  }
  .myc-shelf-label {
    font-weight: 600;
    font-size: 0.9375rem;
    color: var(--color-base-content);
  }
  .myc-shelf-count {
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    color: color-mix(in oklch, var(--color-base-content) 55%, transparent);
  }
  .myc-shelf-rule {
    flex: 1;
    height: 1px;
    background: var(--color-base-300);
  }
  .myc-shelf-add {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: var(--ac);
    background: none;
    border: none;
    cursor: pointer;
    white-space: nowrap;
  }
  .myc-shelf-add:hover {
    text-decoration: underline;
  }

  /* Card grid (shelves + grid view share the card) */
  .myc-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 0.75rem;
  }
  .myc-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    text-align: left;
    padding: 0.85rem 0.95rem 0.75rem;
    border: 1px solid var(--color-base-300);
    border-radius: 0.75rem;
    background: var(--color-base-100);
    cursor: pointer;
    overflow: hidden;
    transition:
      border-color 0.15s,
      box-shadow 0.15s,
      transform 0.15s;
  }
  .myc-card::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: var(--ac);
  }
  .myc-card:hover {
    border-color: color-mix(in oklch, var(--ac) 45%, var(--color-base-300));
    box-shadow: 0 2px 10px -4px color-mix(in oklch, var(--ac) 40%, transparent);
    transform: translateY(-1px);
  }
  .myc-card-tag {
    align-self: flex-start;
    font-size: 0.625rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ac);
    background: color-mix(in oklch, var(--ac) 12%, transparent);
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
  }
  .myc-card-title {
    font-weight: 600;
    font-size: 0.9375rem;
    line-height: 1.3;
    color: var(--color-base-content);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .myc-card-desc {
    font-size: 0.8125rem;
    color: color-mix(in oklch, var(--color-base-content) 65%, transparent);
    display: -webkit-box;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .myc-card-foot {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    margin-top: auto;
    padding-top: 0.3rem;
    font-size: 0.6875rem;
    color: color-mix(in oklch, var(--color-base-content) 55%, transparent);
  }
  .myc-card-dot {
    opacity: 0.5;
  }
  .myc-globe {
    width: 0.75rem;
    height: 0.75rem;
    flex-shrink: 0;
  }

  /* Empty create tile */
  .myc-empty-tile {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    width: 100%;
    padding: 1rem;
    border: 1.5px dashed color-mix(in oklch, var(--ac) 45%, var(--color-base-300));
    border-radius: 0.75rem;
    background: color-mix(in oklch, var(--ac) 5%, transparent);
    color: var(--ac);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s;
  }
  .myc-empty-tile:hover {
    background: color-mix(in oklch, var(--ac) 11%, transparent);
    border-color: var(--ac);
  }
  .myc-empty-tile-tall {
    min-height: 8rem;
    flex-direction: column;
  }

  /* List view */
  .myc-list {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-base-300);
    border-radius: 0.75rem;
    overflow: hidden;
    background: var(--color-base-100);
  }
  .myc-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    text-align: left;
    width: 100%;
    padding: 0.7rem 0.9rem;
    background: none;
    border: none;
    border-bottom: 1px solid var(--color-base-300);
    cursor: pointer;
    transition: background 0.12s;
  }
  .myc-row:last-child {
    border-bottom: none;
  }
  .myc-row:hover {
    background: var(--color-base-200);
  }
  .myc-row-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.5rem;
    flex-shrink: 0;
    color: var(--ac, var(--color-base-content));
    background: color-mix(in oklch, var(--ac, var(--color-base-content)) 12%, transparent);
  }
  .myc-row-main {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
    flex: 1;
  }
  .myc-row-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-base-content);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .myc-row-meta {
    font-size: 0.6875rem;
    color: color-mix(in oklch, var(--color-base-content) 55%, transparent);
  }
  .myc-row-status {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.6875rem;
    color: color-mix(in oklch, var(--color-base-content) 55%, transparent);
    white-space: nowrap;
  }
  .myc-row-create {
    color: var(--color-primary);
  }
  .myc-row-create .myc-row-icon {
    color: var(--color-primary);
    background: color-mix(in oklch, var(--color-primary) 14%, transparent);
  }
  .myc-row-create .myc-row-title {
    color: var(--color-primary);
  }

  /* Empty hub */
  .myc-hub {
    text-align: center;
    padding: 2.5rem 1rem;
    border: 1px solid var(--color-base-300);
    border-radius: 1rem;
    background: var(--color-base-100);
  }
  .myc-hub-eyebrow {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: color-mix(in oklch, var(--color-base-content) 50%, transparent);
  }
  .myc-hub-title {
    margin-top: 0.4rem;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--color-base-content);
  }
  .myc-hub-body {
    margin-top: 0.35rem;
    font-size: 0.875rem;
    color: color-mix(in oklch, var(--color-base-content) 60%, transparent);
  }
  .myc-hub-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.6rem;
    max-width: 36rem;
    margin: 1.5rem auto 0;
  }
  .myc-hub-tile {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.8rem 0.9rem;
    border: 1px solid var(--color-base-300);
    border-radius: 0.75rem;
    background: var(--color-base-100);
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s,
      transform 0.15s;
  }
  .myc-hub-tile:hover {
    border-color: color-mix(in oklch, var(--ac) 50%, var(--color-base-300));
    background: color-mix(in oklch, var(--ac) 6%, transparent);
    transform: translateY(-1px);
  }
  .myc-hub-tile-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 0.5rem;
    color: var(--ac);
    background: color-mix(in oklch, var(--ac) 14%, transparent);
    flex-shrink: 0;
  }
  .myc-hub-tile-label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-base-content);
  }
  :global(.myc-hub-tile-plus) {
    margin-left: auto;
    color: color-mix(in oklch, var(--color-base-content) 40%, transparent);
  }
</style>
