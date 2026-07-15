<!--
  DashboardFeedSelector — Clickable heading that opens a dropdown to switch feed sources.
  Base sources (communities/following/combined) plus a "Relays" section whose entries
  are deployment-gated via FEED_RELAY_SOURCES (see relay-feed-options.svelte.js).
  Reads/writes appSettings.dashboardFeedSource / dashboardFeedRelay / dashboardCustomRelays.
-->

<script>
  import { appSettings } from '$lib/stores/app-settings.svelte.js';
  import { useRelayFeedOptions } from '$lib/stores/relay-feed-options.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { relayHostLabel, resolveFeedRelaySources } from '$lib/helpers/relay-feed.js';
  import {
    PeopleIcon,
    UserIcon,
    GridIcon,
    ChevronDownIcon,
    RelayIcon,
    PlusIcon,
    CloseIcon
  } from '$lib/components/icons';
  import AddRelayModal from './AddRelayModal.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ id: 'communities' | 'following' | 'combined', label: () => string, icon: any }[]} */
  const FEED_OPTIONS = [
    { id: 'communities', label: () => m.dashboard_feed_selector_communities(), icon: PeopleIcon },
    { id: 'following', label: () => m.dashboard_feed_selector_following(), icon: UserIcon },
    { id: 'combined', label: () => m.dashboard_feed_selector_combined(), icon: GridIcon }
  ];

  const getRelayOptions = useRelayFeedOptions();
  let relayOptions = $derived(getRelayOptions());
  let customAllowed = $derived(resolveFeedRelaySources(runtimeConfig.feed).has('custom'));
  let showRelaySection = $derived(relayOptions.length > 0 || customAllowed);
  let addRelayOpen = $state(false);

  let isRelayFeed = $derived(
    appSettings.dashboardFeedSource === 'relay' && !!appSettings.dashboardFeedRelay
  );
  let activeOption = $derived(
    FEED_OPTIONS.find((o) => o.id === appSettings.dashboardFeedSource) || FEED_OPTIONS[0]
  );
  const ActiveIcon = $derived(activeOption.icon);

  function closeDropdown() {
    /** @type {HTMLElement | null} */ (document.activeElement)?.blur();
  }

  /** @param {'communities' | 'following' | 'combined'} id */
  function selectFeed(id) {
    appSettings.dashboardFeedSource = id;
    closeDropdown();
  }

  /** @param {string} url */
  function selectRelay(url) {
    appSettings.dashboardFeedRelay = url;
    appSettings.dashboardFeedSource = 'relay';
    closeDropdown();
  }

  /** @param {string} url */
  function removeCustomRelay(url) {
    appSettings.dashboardCustomRelays = appSettings.dashboardCustomRelays.filter((u) => u !== url);
    if (appSettings.dashboardFeedSource === 'relay' && appSettings.dashboardFeedRelay === url) {
      appSettings.dashboardFeedSource = 'communities';
      appSettings.dashboardFeedRelay = '';
    }
  }

  /** @param {string} url — already normalized by the modal */
  function handleAddRelay(url) {
    if (!appSettings.dashboardCustomRelays.includes(url)) {
      appSettings.dashboardCustomRelays = [...appSettings.dashboardCustomRelays, url];
    }
    addRelayOpen = false;
    selectRelay(url);
  }
</script>

<div class="dropdown dropdown-end">
  <button
    class="flex items-center gap-1.5 rounded-full border border-base-300 bg-base-100 px-3.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-base-200"
    tabindex="0"
  >
    {#if isRelayFeed}
      <RelayIcon class_="w-3.5 h-3.5" />
      {relayHostLabel(appSettings.dashboardFeedRelay)}
    {:else}
      <ActiveIcon class_="w-3.5 h-3.5" />
      {activeOption.label()}
    {/if}
    <ChevronDownIcon class_="w-3 h-3 opacity-60" />
  </button>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <ul tabindex="0" class="dropdown-content menu z-10 w-64 rounded-box bg-base-100 p-2 shadow-lg">
    {#each FEED_OPTIONS as option (option.id)}
      {@const Icon = option.icon}
      <li>
        <button
          class="flex items-center gap-2"
          class:active={!isRelayFeed && option.id === appSettings.dashboardFeedSource}
          onclick={() => selectFeed(option.id)}
        >
          <Icon class_="w-4 h-4" />
          {option.label()}
        </button>
      </li>
    {/each}

    {#if showRelaySection}
      <li class="mt-1 menu-title">{m.dashboard_feed_selector_relays_label()}</li>
    {/if}
    {#each relayOptions as relay (relay.url)}
      <li>
        <div class="flex items-center gap-0 p-0">
          <button
            class="flex min-w-0 flex-1 items-center gap-2 px-3 py-2"
            class:active={isRelayFeed && relay.url === appSettings.dashboardFeedRelay}
            onclick={() => selectRelay(relay.url)}
          >
            <RelayIcon class_="w-4 h-4 shrink-0" />
            <span class="truncate">{relay.label}</span>
          </button>
          {#if relay.isCustom}
            <button
              class="btn mr-1 shrink-0 btn-ghost btn-xs"
              aria-label={m.dashboard_feed_selector_remove_relay()}
              onclick={() => removeCustomRelay(relay.url)}
            >
              <CloseIcon class_="w-3 h-3" />
            </button>
          {/if}
        </div>
      </li>
    {/each}
    {#if customAllowed}
      <li>
        <button
          class="flex items-center gap-2"
          onclick={() => {
            closeDropdown();
            addRelayOpen = true;
          }}
        >
          <PlusIcon class_="w-4 h-4" />
          {m.dashboard_feed_selector_add_relay()}
        </button>
      </li>
    {/if}
  </ul>
</div>

{#if customAllowed}
  <AddRelayModal
    open={addRelayOpen}
    onadd={handleAddRelay}
    onclose={() => (addRelayOpen = false)}
  />
{/if}
