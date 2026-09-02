<!--
  ActiveFilterChips Component
  Renders a removable chip per active calendar filter and a "Clear all" link.
  Reads directly from `calendarFilters` so it stays in sync regardless of
  which control added the filter. Each chip's `×` calls the matching store
  helper, so removing a chip has the same effect as unchecking the source.
  URL sync is centralized: CalendarView's filter effect mirrors the store
  into the query params, so store writes here are all that's needed.
-->

<script>
  import { calendarFilters } from '$lib/stores/calendar-filters.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { CloseIcon } from '../icons';
  import * as m from '$lib/paraglide/messages';

  /** @typedef {Object} Props
   *  @property {() => void} [onChange]  Fired whenever a chip removes a filter
   */

  /** @type {Props} */
  let { onChange = () => {} } = $props();

  // Profile map for rendering friendly names on per-person chips.
  const getProfiles = useProfileMap(() => calendarFilters.selectedFeaturedAuthors);

  function personLabel(/** @type {string} */ pubkey) {
    const p = getProfiles().get(pubkey);
    return p?.name || p?.display_name || pubkey.slice(0, 8);
  }

  function listLabel(/** @type {string} */ listId) {
    const list = calendarFilters.followLists.find((l) => l.id === listId);
    return list?.name || listId.slice(0, 8);
  }

  function relayLabel(/** @type {string} */ url) {
    return url.replace(/^wss?:\/\//, '');
  }

  function removeTag(/** @type {string} */ tag) {
    calendarFilters.removeTag(tag);
    onChange();
  }

  function removeSearch() {
    calendarFilters.clearSearchQuery();
    onChange();
  }

  function removeOnlyFollows() {
    calendarFilters.setOnlyFollowsMode('off');
    onChange();
  }

  function removePerson(/** @type {string} */ pubkey) {
    calendarFilters.removeFeaturedAuthor(pubkey);
    onChange();
  }

  function removeList(/** @type {string} */ listId) {
    calendarFilters.setSelectedFollowListIds(
      calendarFilters.selectedFollowListIds.filter((id) => id !== listId)
    );
    onChange();
  }

  function removeRelay(/** @type {string} */ url) {
    calendarFilters.removeRelay(url);
    onChange();
  }

  function clearAll() {
    calendarFilters.clearSelectedTags();
    calendarFilters.clearSearchQuery();
    calendarFilters.setOnlyFollowsMode('off');
    calendarFilters.clearSelectedFeaturedAuthors();
    calendarFilters.clearSelectedFollowListIds();
    calendarFilters.clearSelectedRelays();
    onChange();
  }

  let hasAny = $derived(
    calendarFilters.selectedTags.length > 0 ||
      calendarFilters.searchQuery.trim().length > 0 ||
      calendarFilters.onlyFollowsMode !== 'off' ||
      calendarFilters.selectedFeaturedAuthors.length > 0 ||
      calendarFilters.selectedFollowListIds.length > 0 ||
      calendarFilters.selectedRelays.length > 0
  );
</script>

{#if hasAny}
  <div
    class="flex flex-wrap items-center gap-2 py-2"
    data-testid="active-filter-chips"
    aria-label={m.calendar_filter_active_label()}
  >
    <!-- Tag chips -->
    {#each calendarFilters.selectedTags as tag (tag)}
      <span class="badge gap-1 badge-outline badge-primary" data-testid="chip-tag">
        <span>{m.calendar_filter_chip_tag({ tag: `#${tag}` })}</span>
        <button
          type="button"
          class="hover:opacity-70"
          onclick={() => removeTag(tag)}
          aria-label={m.calendar_filter_chip_remove()}
        >
          <CloseIcon class_="h-3 w-3" />
        </button>
      </span>
    {/each}

    <!-- Search chip -->
    {#if calendarFilters.searchQuery.trim().length > 0}
      <span class="badge gap-1 badge-outline badge-accent" data-testid="chip-search">
        <span>{m.calendar_filter_chip_search({ query: calendarFilters.searchQuery })}</span>
        <button
          type="button"
          class="hover:opacity-70"
          onclick={removeSearch}
          aria-label={m.calendar_filter_chip_remove()}
        >
          <CloseIcon class_="h-3 w-3" />
        </button>
      </span>
    {/if}

    <!-- Only-follows / featured-educators chip -->
    {#if calendarFilters.onlyFollowsMode === 'follows'}
      <span class="badge gap-1 badge-outline badge-secondary" data-testid="chip-only-follows">
        <span>{m.calendar_filter_chip_only_follows()}</span>
        <button
          type="button"
          class="hover:opacity-70"
          onclick={removeOnlyFollows}
          aria-label={m.calendar_filter_chip_remove()}
        >
          <CloseIcon class_="h-3 w-3" />
        </button>
      </span>
    {:else if calendarFilters.onlyFollowsMode === 'featured'}
      <span class="badge gap-1 badge-outline badge-secondary" data-testid="chip-featured">
        <span>{m.calendar_filter_chip_featured()}</span>
        <button
          type="button"
          class="hover:opacity-70"
          onclick={removeOnlyFollows}
          aria-label={m.calendar_filter_chip_remove()}
        >
          <CloseIcon class_="h-3 w-3" />
        </button>
      </span>
    {/if}

    <!-- Individual person chips -->
    {#each calendarFilters.selectedFeaturedAuthors as pubkey (pubkey)}
      <span class="badge gap-1 badge-outline badge-info" data-testid="chip-person">
        <span>{m.calendar_filter_chip_person({ name: personLabel(pubkey) })}</span>
        <button
          type="button"
          class="hover:opacity-70"
          onclick={() => removePerson(pubkey)}
          aria-label={m.calendar_filter_chip_remove()}
        >
          <CloseIcon class_="h-3 w-3" />
        </button>
      </span>
    {/each}

    <!-- Named NIP-51 list chips -->
    {#each calendarFilters.selectedFollowListIds as listId (listId)}
      <span class="badge gap-1 badge-outline badge-info" data-testid="chip-list">
        <span>{m.calendar_filter_chip_list({ name: listLabel(listId) })}</span>
        <button
          type="button"
          class="hover:opacity-70"
          onclick={() => removeList(listId)}
          aria-label={m.calendar_filter_chip_remove()}
        >
          <CloseIcon class_="h-3 w-3" />
        </button>
      </span>
    {/each}

    <!-- Relay chips -->
    {#each calendarFilters.selectedRelays as url (url)}
      <span class="badge gap-1 badge-ghost" data-testid="chip-relay">
        <span>{m.calendar_filter_chip_relay({ relay: relayLabel(url) })}</span>
        <button
          type="button"
          class="hover:opacity-70"
          onclick={() => removeRelay(url)}
          aria-label={m.calendar_filter_chip_remove()}
        >
          <CloseIcon class_="h-3 w-3" />
        </button>
      </span>
    {/each}

    <button
      type="button"
      class="ml-2 link text-xs text-base-content/60 link-hover"
      onclick={clearAll}
      data-testid="chip-clear-all"
    >
      {m.calendar_filter_clear_all()}
    </button>
  </div>
{/if}
