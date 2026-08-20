<!--
  DashboardMyStuff — "Meine Inhalte" shell. Two sub-tabs (Eigene Inhalte / Listen)
  plus a persistent "Neu erstellen" menu so the create entry point is always
  available regardless of how much content exists.
-->
<script>
  import { page } from '$app/stores';
  import DashboardYourContent from './DashboardYourContent.svelte';
  import DashboardLists from './DashboardLists.svelte';
  import { navigateToCreate } from '$lib/helpers/contentCreation.js';
  import { SHELF_ORDER, getContentType } from '$lib/helpers/myContentTypes.js';
  import {
    CalendarIcon,
    GraduationCapIcon,
    WikipediaIcon,
    ScrollTextIcon,
    FilesIcon,
    PollIcon,
    BookmarkIcon,
    PlusIcon,
    ChevronDownIcon,
    PuzzleIcon
  } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ pubkey: string }} */
  let { pubkey } = $props();

  let activeTab = $derived($page.url.searchParams.get('tab') || 'content');

  /** @type {Record<string, { icon: any, label: () => string }>} */
  const CREATE_UI = {
    calendar: { icon: CalendarIcon, label: () => m.fab_create_event() },
    learning: { icon: GraduationCapIcon, label: () => m.fab_create_learning() },
    interactive: { icon: PuzzleIcon, label: () => m.fab_create_interactive() },
    article: { icon: ScrollTextIcon, label: () => m.article_fab_write() },
    wiki: { icon: WikipediaIcon, label: () => m.wiki_fab_write() },
    form: { icon: FilesIcon, label: () => m.fab_create_form() },
    poll: { icon: PollIcon, label: () => m.fab_create_poll() },
    bookmark: { icon: BookmarkIcon, label: () => m.fab_add_bookmark() }
  };

  /** @param {string} key */
  function handleCreate(key) {
    // Close the dropdown by removing focus, then route/open modal.
    if (typeof document !== 'undefined') {
      const el = /** @type {HTMLElement | null} */ (document.activeElement);
      el?.blur();
    }
    // Route via ctaKey — interactive has no create flow of its own (shares learning's).
    navigateToCreate(getContentType(key)?.ctaKey ?? key);
  }
</script>

<section>
  <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
    <h1 class="text-2xl font-bold">{m.mycontent_heading()}</h1>

    <div class="dropdown dropdown-end">
      <div tabindex="0" role="button" class="btn gap-2 btn-sm btn-primary">
        <PlusIcon class_="h-4 w-4" />
        {m.mycontent_create_new()}
        <ChevronDownIcon class_="h-4 w-4" />
      </div>
      <ul
        class="dropdown-content menu z-10 mt-2 w-60 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
      >
        <li class="menu-title text-xs">{m.mycontent_create_prompt()}</li>
        {#each SHELF_ORDER as key (key)}
          {@const Icon = CREATE_UI[key].icon}
          {@const accent = getContentType(key)?.accent}
          <li>
            <button onclick={() => handleCreate(key)}>
              <span
                class="flex h-6 w-6 items-center justify-center rounded-md"
                style="color: {accent}; background: color-mix(in oklch, {accent} 14%, transparent)"
              >
                <Icon class_="h-4 w-4" />
              </span>
              {CREATE_UI[key].label()}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  </div>

  <!-- Sub-tab segmented control -->
  <div role="tablist" class="mb-5 inline-flex rounded-lg border border-base-300 bg-base-200 p-1">
    <a
      href="?view=my-stuff&tab=content"
      role="tab"
      aria-selected={activeTab === 'content'}
      class="rounded-md px-4 py-1.5 text-sm font-medium transition-colors {activeTab === 'content'
        ? 'bg-base-100 text-base-content shadow-sm'
        : 'text-base-content/60 hover:text-base-content'}"
    >
      {m.dashboard_my_stuff_tab_content()}
    </a>
    <a
      href="?view=my-stuff&tab=lists"
      role="tab"
      aria-selected={activeTab === 'lists'}
      class="rounded-md px-4 py-1.5 text-sm font-medium transition-colors {activeTab === 'lists'
        ? 'bg-base-100 text-base-content shadow-sm'
        : 'text-base-content/60 hover:text-base-content'}"
    >
      {m.dashboard_my_stuff_tab_lists()}
    </a>
  </div>

  {#if activeTab === 'lists'}
    <DashboardLists {pubkey} />
  {:else}
    <DashboardYourContent {pubkey} />
  {/if}
</section>
