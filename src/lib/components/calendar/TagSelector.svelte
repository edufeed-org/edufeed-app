<!--
  TagSelector Component
  Displays popular tags from calendar events and allows filtering by tags
-->

<script>
  // @ts-ignore - SvelteMap/SvelteSet are valid reactive collections
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { page } from '$app/stores';
  import { calendarFilters } from '$lib/stores/calendar-filters.svelte.js';
  import { updateQueryParams } from '$lib/helpers/urlParams.js';
  import { PlusIcon, TagIcon } from '../icons';
  import * as m from '$lib/paraglide/messages';

  // Props
  let { events = [], onTagFilterChange = () => {} } = $props();

  // Sync local state with store (which is synced from URL in CalendarView)
  let selectedTags = $derived(calendarFilters.selectedTags);

  // Custom-tag input state. Lets users add tags that are not in the popular-15
  // list (mirrors the custom-relay input in RelaySelector.svelte).
  let customTagInput = $state('');
  let error = $state(/** @type {string | null} */ (null));

  /**
   * Add a user-typed tag. Trims, strips a leading `#`, lowercases, dedupes,
   * then routes through the existing toggleTag() so store + URL stay in sync.
   * The chip renders automatically because selectedNotPopular prepends any
   * selected-but-not-popular tag to displayedTags.
   */
  function addCustomTag() {
    error = null;
    const raw = customTagInput.trim();
    if (!raw) return;

    const normalized = raw.replace(/^#/, '').trim().toLowerCase();
    if (!normalized) return;

    if (selectedTags.includes(normalized)) {
      error = m.tag_selector_already_selected();
      return;
    }

    toggleTag(normalized);
    customTagInput = '';
  }

  /**
   * Get all tag counts from events
   * @param {import('$lib/types/calendar.js').CalendarEvent[]} events
   * @returns {Map<string, number>}
   */
  function getAllTagCounts(events) {
    const tagCounts = new SvelteMap();

    // Count all hashtags
    events.forEach((event) => {
      event.hashtags?.forEach((tag) => {
        if (tag && tag.trim()) {
          // Normalize: lowercase and trim
          const normalized = tag.toLowerCase().trim();
          tagCounts.set(normalized, (tagCounts.get(normalized) || 0) + 1);
        }
      });
    });

    return tagCounts;
  }

  /**
   * Get tags to display: selected tags + popular tags
   * @param {import('$lib/types/calendar.js').CalendarEvent[]} events
   * @param {string[]} selectedTags
   * @param {number} popularLimit
   * @returns {{ tag: string, count: number, isSelected: boolean }[]}
   */
  function getDisplayedTags(events, selectedTags, popularLimit = 15) {
    const tagCounts = getAllTagCounts(events);

    // Get top N popular tags
    const popularTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, popularLimit)
      .map(([tag, count]) => ({
        tag,
        count,
        isSelected: selectedTags.includes(tag)
      }));

    // Find selected tags that aren't in the popular list
    const popularTagNames = new SvelteSet(popularTags.map((t) => t.tag));
    const selectedNotPopular = selectedTags
      .filter((tag) => !popularTagNames.has(tag))
      .map((tag) => ({
        tag,
        count: tagCounts.get(tag) || 0,
        isSelected: true
      }));

    // Combine: selected (not popular) first, then popular tags
    return [...selectedNotPopular, ...popularTags];
  }

  /**
   * Toggle tag selection
   * @param {string} tag
   */
  function toggleTag(tag) {
    const newTags = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag];

    // Update store
    calendarFilters.setSelectedTags(newTags);

    // Update URL
    updateQueryParams($page.url.searchParams, { tags: newTags });

    // Notify parent
    onTagFilterChange(newTags);
    console.log('🏷️ Selected tags:', newTags);
  }

  /**
   * Clear all selected tags
   */
  function clearTags() {
    console.log('🏷️ Clearing tag filters');

    // Update store
    calendarFilters.clearSelectedTags();

    // Update URL (empty array removes the parameter)
    updateQueryParams($page.url.searchParams, { tags: [] });

    // Notify parent
    onTagFilterChange([]);
  }

  // Derived state
  let displayedTags = $derived(getDisplayedTags(events, selectedTags));
  let hasActiveTags = $derived(selectedTags.length > 0);
  let hasTags = $derived(displayedTags.length > 0);
</script>

<div class="border-b border-base-300 bg-base-100 px-6 py-4">
  <!-- Header -->
  <div class="mb-3 flex items-center gap-3">
    <TagIcon class="h-4 w-4 text-base-content/70" />
    <span class="font-medium text-base-content">{m.tag_selector_filter_by_tags()}</span>
    {#if hasActiveTags}
      <span class="badge badge-sm badge-primary">{selectedTags.length}</span>
    {/if}
  </div>

  {#if hasTags}
    <!-- Tag buttons grid -->
    <div class="flex flex-wrap gap-2">
      {#each displayedTags as { tag, count, isSelected } (tag)}
        <button
          class="btn gap-1 btn-sm"
          class:btn-primary={isSelected}
          class:btn-ghost={!isSelected}
          onclick={() => toggleTag(tag)}
          title={m.tag_selector_show_events_with_tag({ tag })}
        >
          <span class="text-xs opacity-70">#</span>{tag}
          <span class="badge badge-sm">{count}</span>
        </button>
      {/each}
    </div>

    <!-- Clear button -->
    {#if hasActiveTags}
      <div class="mt-3 flex items-center gap-3">
        <button class="btn btn-ghost btn-sm" onclick={clearTags}
          >{m.tag_selector_clear_all()}</button
        >
        <p class="text-xs text-base-content/60">
          {selectedTags.length === 1
            ? m.tag_selector_showing_events_single()
            : m.tag_selector_showing_events_multiple({ count: selectedTags.length })}
        </p>
      </div>
    {:else}
      <p class="mt-3 text-xs text-base-content/60">
        {m.tag_selector_events_help()}
      </p>
    {/if}
  {:else}
    <!-- Empty state -->
    <div class="text-center text-sm text-base-content/50">
      <p>{m.tag_selector_no_tags()}</p>
    </div>
  {/if}

  <!-- Custom tag input (always visible — surfaces tags not in the popular list) -->
  <div class="mt-3">
    <div class="flex gap-1">
      <input
        type="text"
        class="input-bordered input input-sm flex-1"
        placeholder={m.tag_selector_custom_placeholder()}
        bind:value={customTagInput}
        oninput={() => {
          error = null;
        }}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addCustomTag();
          }
        }}
        data-testid="tag-custom-input"
      />
      <button
        type="button"
        class="btn gap-1 btn-sm btn-primary"
        onclick={addCustomTag}
        disabled={!customTagInput.trim()}
        data-testid="tag-custom-add"
      >
        <PlusIcon class_="h-3 w-3" />
        {m.tag_selector_add()}
      </button>
    </div>
    {#if error}
      <p class="mt-1 text-xs text-warning" data-testid="tag-custom-error">{error}</p>
    {/if}
  </div>
</div>
