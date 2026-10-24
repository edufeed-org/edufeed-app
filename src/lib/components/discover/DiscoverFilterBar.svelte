<!--
  DiscoverFilterBar — the general filters of /discover (sort, community,
  relay), the tab-specific filters (events date range, learning SKOS
  filters) and the results count. Props only; the page owns the state.
-->
<script>
  import CommunityFilterDropdown from '$lib/components/feed/CommunityFilterDropdown.svelte';
  import RelayFilterDropdown from '$lib/components/feed/RelayFilterDropdown.svelte';
  import EventDateRangeFilter from '$lib/components/calendar/EventDateRangeFilter.svelte';
  import HiddenSourcesToggle from '$lib/components/calendar/HiddenSourcesToggle.svelte';
  import LearningContentFilters from '$lib/components/educational/LearningContentFilters.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   contentType: string,
   *   sortBy: string,
   *   canSortByRelevance: boolean,
   *   activeUser: any,
   *   communityFilter: string | null,
   *   communityOptions: { joined: any[], discover: any[] },
   *   oncommunitychange: (value: string | null) => void,
   *   relayCategory: string | null,
   *   availableRelays: string[],
   *   relayFilter: string | null,
   *   onrelaychange: (value: string | null) => void,
   *   eventsRange: { start: number, end: number },
   *   onrangechange: (range: { start: number, end: number }) => void,
   *   hiddenCalendarCount?: number,
   *   onlearningfilterchange: (filters: any) => void,
   *   learningIsSearching: boolean,
   *   searchText: string,
   *   resultCount: number,
   *   hasMore: boolean
   * }}
   */
  let {
    contentType,
    sortBy = $bindable('newest'),
    canSortByRelevance,
    activeUser,
    communityFilter,
    communityOptions,
    oncommunitychange,
    relayCategory,
    availableRelays,
    relayFilter,
    onrelaychange,
    eventsRange,
    onrangechange,
    hiddenCalendarCount = 0,
    onlearningfilterchange,
    learningIsSearching,
    searchText,
    resultCount,
    hasMore
  } = $props();

  const isListTab = $derived(contentType !== 'communities' && contentType !== 'people');
</script>

<!-- Row 2: General filters (sort, community, relay) -->
<div class="flex flex-wrap items-end gap-4" data-testid="general-filters">
  {#if isListTab}
    <div class="form-control w-full sm:w-auto sm:min-w-[160px]">
      <label for="sort" class="label">
        <span class="label-text font-medium">{m.discover_sort_label()}</span>
      </label>
      <select id="sort" bind:value={sortBy} class="select-bordered select w-full">
        {#if canSortByRelevance}
          <option value="relevance">{m.discover_sort_relevance()}</option>
        {/if}
        <option value="newest">{m.discover_sort_newest()}</option>
        <option value="oldest">{m.discover_sort_oldest()}</option>
      </select>
    </div>
  {/if}

  <!-- Community filter: logged-in users, list tabs only -->
  {#if activeUser && isListTab}
    <div class="w-full sm:w-auto sm:min-w-[200px]">
      <CommunityFilterDropdown
        value={communityFilter}
        joinedCommunities={communityOptions.joined}
        discoverCommunities={communityOptions.discover}
        onchange={oncommunitychange}
      />
    </div>
  {/if}

  <!-- Relay filter: tabs with app-specific relays -->
  {#if relayCategory && availableRelays.length > 0}
    <div class="w-full sm:w-auto sm:min-w-[200px]">
      <RelayFilterDropdown
        relays={availableRelays}
        value={relayFilter}
        onchange={onrelaychange}
        settingsCategory={relayCategory}
      />
    </div>
  {/if}
</div>

<!-- Row 3: Tab-specific filters -->
{#if contentType === 'events'}
  <div data-testid="tab-filters" class="flex flex-wrap items-center gap-2">
    <EventDateRangeFilter start={eventsRange.start} end={eventsRange.end} {onrangechange} />
    <HiddenSourcesToggle hidden={hiddenCalendarCount} />
  </div>
{/if}
{#if contentType === 'learning'}
  <div data-testid="tab-filters">
    <LearningContentFilters
      onfilterchange={onlearningfilterchange}
      isSearching={learningIsSearching}
      {searchText}
    />
  </div>
{/if}

<!-- Results count (communities render their own) -->
{#if contentType !== 'communities' && resultCount > 0}
  <div class="text-center text-sm text-base-content/70">
    {m.discover_results_count({ count: resultCount })}
    {#if hasMore}
      <span class="ml-2 text-primary">• {m.discover_scroll_for_more()}</span>
    {/if}
  </div>
{/if}
