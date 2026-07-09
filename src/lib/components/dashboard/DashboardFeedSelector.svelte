<!--
  DashboardFeedSelector — Clickable heading that opens a dropdown to switch feed sources.
  Replaces the "Community Activity" heading with the active feed name + chevron.
  Reads/writes appSettings.dashboardFeedSource. Extensible for future relay-based feeds.
-->

<script>
  import { appSettings } from '$lib/stores/app-settings.svelte.js';
  import { PeopleIcon, UserIcon, GridIcon, ChevronDownIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ id: 'communities' | 'following' | 'combined', label: () => string, icon: any }[]} */
  const FEED_OPTIONS = [
    { id: 'communities', label: () => m.dashboard_feed_selector_communities(), icon: PeopleIcon },
    { id: 'following', label: () => m.dashboard_feed_selector_following(), icon: UserIcon },
    { id: 'combined', label: () => m.dashboard_feed_selector_combined(), icon: GridIcon }
  ];

  let activeOption = $derived(
    FEED_OPTIONS.find((o) => o.id === appSettings.dashboardFeedSource) || FEED_OPTIONS[0]
  );
  const ActiveIcon = $derived(activeOption.icon);

  /** @param {'communities' | 'following' | 'combined'} id */
  function selectFeed(id) {
    appSettings.dashboardFeedSource = id;
    // Close the dropdown by blurring the active element
    /** @type {HTMLElement | null} */ (document.activeElement)?.blur();
  }
</script>

<div class="dropdown dropdown-end">
  <button
    class="flex items-center gap-1.5 rounded-full border border-base-300 bg-base-100 px-3.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-base-200"
    tabindex="0"
  >
    <ActiveIcon class_="w-3.5 h-3.5" />
    {activeOption.label()}
    <ChevronDownIcon class_="w-3 h-3 opacity-60" />
  </button>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <ul tabindex="0" class="dropdown-content menu z-10 w-56 rounded-box bg-base-200 p-2 shadow-lg">
    {#each FEED_OPTIONS as option (option.id)}
      {@const Icon = option.icon}
      <li>
        <button
          class="flex items-center gap-2"
          class:active={option.id === appSettings.dashboardFeedSource}
          onclick={() => selectFeed(option.id)}
        >
          <Icon class_="w-4 h-4" />
          {option.label()}
        </button>
      </li>
    {/each}
  </ul>
</div>
