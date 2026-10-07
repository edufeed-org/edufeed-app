<!--
  FeedCategoryChips — content-type filter chips for feeds, following the
  chart-legend convention (issue #35): body click toggles the category in
  the multi-select set, the eye button hides/unhides it. Pure view: the
  owner keeps the CategorySelection and applies the toggle helpers from
  $lib/helpers/profile-feed.js.
-->
<script>
  import {
    ChatIcon,
    CalendarIcon,
    GraduationCapIcon,
    BookIcon,
    BookmarkIcon,
    PollIcon,
    EyeIcon,
    EyeOffIcon,
    EditIcon,
    RepostIcon,
    ForumIcon,
    WikipediaIcon,
    KanbanIcon
  } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   categories: string[],
   *   selection: import('$lib/helpers/profile-feed.js').CategorySelection,
   *   onselect: (id: string) => void,
   *   onhide: (id: string) => void
   * }}
   */
  let { categories, selection, onselect, onhide } = $props();

  /** Chip label + icon per category id */
  const CHIP_DEFS = /** @type {Record<string, { label: () => string, icon: any }>} */ ({
    notes: { label: () => m.profile_tab_notes(), icon: ChatIcon },
    calendar: { label: () => m.profile_tab_calendar(), icon: CalendarIcon },
    resources: { label: () => m.profile_tab_resources(), icon: GraduationCapIcon },
    articles: { label: () => m.profile_tab_articles(), icon: BookIcon },
    forum: { label: () => m.feed_category_forum(), icon: ForumIcon },
    wikis: { label: () => m.feed_category_wikis(), icon: WikipediaIcon },
    boards: { label: () => m.feed_category_boards(), icon: KanbanIcon },
    bookmarks: { label: () => m.profile_tab_bookmarks(), icon: BookmarkIcon },
    highlights: { label: () => m.profile_tab_highlights(), icon: EditIcon },
    shared: { label: () => m.profile_tab_shared(), icon: RepostIcon },
    polls: { label: () => m.profile_tab_polls(), icon: PollIcon }
  });

  const chips = $derived(
    categories.filter((id) => CHIP_DEFS[id]).map((id) => ({ id, ...CHIP_DEFS[id] }))
  );
</script>

<div class="relative pb-4">
  <!-- Layout follows the INPUT, not just the width: swipe-scroll is only
       natural on coarse pointers (touch), so narrow touch screens get the
       single-line scroll (hidden scrollbar + edge fade), while any
       fine-pointer window (mouse/trackpad — even narrow ones) and md+
       wraps onto rows. Mirrors FeaturedAuthors/TopPublishersFilter. -->
  <div
    class="pf-chip-row flex flex-nowrap gap-2 overflow-x-auto md:flex-wrap md:overflow-visible pointer-fine:flex-wrap pointer-fine:overflow-visible"
    data-testid="feed-filter-row"
  >
    {#each chips as chip (chip.id)}
      {@const Icon = chip.icon}
      {@const isHidden = selection.hidden.includes(chip.id)}
      {@const isSelected = selection.selected.includes(chip.id)}
      {@const dimmed = isHidden || (selection.selected.length > 0 && !isSelected)}
      <span
        class="join {dimmed ? 'opacity-45' : ''}"
        data-testid="feed-filter-chip"
        data-category={chip.id}
      >
        <button
          class="btn join-item gap-1 btn-xs {isSelected ? 'btn-primary' : 'btn-outline'}"
          onclick={() => onselect(chip.id)}
          aria-pressed={isSelected}
          aria-label={isSelected
            ? m.feed_filter_deselect_aria({ name: chip.label() })
            : m.feed_filter_select_aria({ name: chip.label() })}
          title={isSelected
            ? m.feed_filter_deselect_aria({ name: chip.label() })
            : m.feed_filter_select_aria({ name: chip.label() })}
        >
          <Icon class_="w-3 h-3" title="" />
          <span class={isHidden ? 'line-through' : ''}>{chip.label()}</span>
        </button>
        <button
          class="btn join-item px-1.5 btn-outline btn-xs"
          onclick={() => onhide(chip.id)}
          aria-pressed={isHidden}
          aria-label={isHidden
            ? m.feed_filter_show_aria({ name: chip.label() })
            : m.feed_filter_hide_aria({ name: chip.label() })}
          title={isHidden
            ? m.feed_filter_show_aria({ name: chip.label() })
            : m.feed_filter_hide_aria({ name: chip.label() })}
        >
          {#if isHidden}
            <EyeOffIcon class_="w-3 h-3" title="" />
          {:else}
            <EyeIcon class_="w-3 h-3" title="" />
          {/if}
        </button>
      </span>
    {/each}
  </div>
  <div
    class="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-base-100 to-transparent md:hidden pointer-fine:hidden"
  ></div>
</div>

<style>
  .pf-chip-row {
    scrollbar-width: none;
  }
  .pf-chip-row::-webkit-scrollbar {
    display: none;
  }
</style>
