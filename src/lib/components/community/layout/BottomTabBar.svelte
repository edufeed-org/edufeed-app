<script>
  import {
    HomeIcon,
    ChatIcon,
    CalendarIcon,
    SettingsIcon,
    BookIcon,
    GraduationCapIcon,
    KanbanIcon,
    ScrollTextIcon,
    ForumIcon,
    BookmarkShareIcon,
    MeetIcon,
    PollIcon,
    LockIcon,
    LockOpenIcon
  } from '$lib/components/icons';
  import { getCommunityTabs } from '$lib/helpers/contentTypes.js';
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    selectedContentType = $bindable(),
    onContentTypeSelect,
    communityEvent = null, // The community's kind:10222 event
    restrictedTabs = /** @type {Set<string>} */ (new Set()),
    accessibleTabs = /** @type {Set<string>} */ (new Set())
  } = $props();

  // Icon mapping for content types
  /** @type {Record<string, any>} */
  const iconMap = {
    home: HomeIcon,
    chat: ChatIcon,
    calendar: CalendarIcon,
    learning: GraduationCapIcon,
    boards: KanbanIcon,
    articles: ScrollTextIcon,
    forum: ForumIcon,
    wikis: BookIcon,
    'social-bookmarks': BookmarkShareIcon,
    meet: MeetIcon,
    polls: PollIcon,
    settings: SettingsIcon
  };

  /** @type {Record<string, () => string>} */
  const tabLabelMap = {
    home: () => m.community_layout_bottom_tab_bar_home(),
    chat: () => m.community_layout_bottom_tab_bar_chat(),
    calendar: () => m.community_layout_bottom_tab_bar_calendar(),
    learning: () => m.community_layout_bottom_tab_bar_learning(),
    boards: () => m.community_layout_bottom_tab_bar_boards(),
    articles: () => m.community_layout_bottom_tab_bar_articles(),
    forum: () => m.community_layout_bottom_tab_bar_forum(),
    wikis: () => m.community_wikis_title(),
    'social-bookmarks': () => m.community_layout_bottom_tab_bar_social_bookmarks(),
    meet: () => m.community_layout_bottom_tab_bar_meet(),
    polls: () => m.community_layout_bottom_tab_bar_polls(),
    settings: () => m.community_layout_bottom_tab_bar_settings()
  };

  // State for scroll indicators
  let scrollContainer = $state(/** @type {HTMLElement|null} */ (null));
  let showLeftScroll = $state(false);
  let showRightScroll = $state(false);

  const contentTypes = $derived(
    getCommunityTabs(communityEvent).map((id) => ({
      id,
      label: tabLabelMap[id]?.() ?? id,
      icon: iconMap[id] ?? ChatIcon
    }))
  );

  /**
   * Handle content type selection
   * @param {string} type
   */
  function handleDockClick(type) {
    if (onContentTypeSelect) {
      onContentTypeSelect(type);
    }
  }

  /**
   * Check scroll position and update indicators
   */
  function updateScrollIndicators() {
    if (!scrollContainer) return;

    const { scrollLeft, scrollWidth, clientWidth } = scrollContainer;
    showLeftScroll = scrollLeft > 10;
    showRightScroll = scrollLeft < scrollWidth - clientWidth - 10;
  }

  /**
   * Scroll the dock left or right
   * @param {'left'|'right'} direction
   */
  function scrollDock(direction) {
    if (!scrollContainer) return;

    const scrollAmount = 200;
    const newScrollLeft =
      direction === 'left'
        ? scrollContainer.scrollLeft - scrollAmount
        : scrollContainer.scrollLeft + scrollAmount;

    scrollContainer.scrollTo({
      left: newScrollLeft,
      behavior: 'smooth'
    });
  }

  onMount(() => {
    if (scrollContainer) {
      updateScrollIndicators();
      scrollContainer.addEventListener('scroll', updateScrollIndicators);
      window.addEventListener('resize', updateScrollIndicators);

      return () => {
        scrollContainer?.removeEventListener('scroll', updateScrollIndicators);
        window.removeEventListener('resize', updateScrollIndicators);
      };
    }
  });
</script>

<!-- Mobile/Tablet: Dock Navigation -->
<div
  class="pb-safe fixed right-0 bottom-0 left-0 z-50 border-t border-base-300 bg-base-100 lg:hidden"
>
  <div class="relative">
    <!-- Left scroll indicator -->
    {#if showLeftScroll}
      <button
        onclick={() => scrollDock('left')}
        class="absolute top-0 bottom-0 left-0 z-10 flex w-12 items-center justify-start bg-gradient-to-r from-base-100 to-transparent pl-2"
        aria-label={m.community_layout_bottom_tab_bar_scroll_left()}
      >
        <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 19l-7-7 7-7"
          />
        </svg>
      </button>
    {/if}

    <!-- Right scroll indicator -->
    {#if showRightScroll}
      <button
        onclick={() => scrollDock('right')}
        class="absolute top-0 right-0 bottom-0 z-10 flex w-12 items-center justify-end bg-gradient-to-l from-base-100 to-transparent pr-2"
        aria-label={m.community_layout_bottom_tab_bar_scroll_right()}
      >
        <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    {/if}

    <!-- Dock container with horizontal scroll -->
    <div
      bind:this={scrollContainer}
      class="scrollbar-hide snap-x snap-mandatory overflow-x-auto"
      style="scroll-behavior: smooth;"
    >
      <!-- DaisyUI Dock Component -->
      <div class="flex w-max items-center gap-3 px-4 py-2">
        {#each contentTypes as type (type.id)}
          {@const isActive = selectedContentType === type.id}
          {@const Icon = type.icon}
          <button
            onclick={() => handleDockClick(type.id)}
            class="flex flex-shrink-0 snap-center flex-col items-center gap-1 rounded-lg px-2 py-1.5 {isActive
              ? 'bg-primary/10 text-primary'
              : 'text-base-content/70'}"
            title={type.label}
            aria-label={type.label}
          >
            <span class="relative">
              <Icon class_="size-[1.4em]" />
              {#if restrictedTabs.has(type.id)}
                <span
                  class="absolute -top-1 -right-1.5"
                  title={accessibleTabs.has(type.id)
                    ? m.community_content_tab_access_granted()
                    : m.community_content_tab_restricted()}
                >
                  {#if accessibleTabs.has(type.id)}
                    <LockOpenIcon class_="w-2.5 h-2.5 text-success" />
                  {:else}
                    <LockIcon class_="w-2.5 h-2.5 opacity-60" />
                  {/if}
                </span>
              {/if}
            </span>
            <span class="text-[10px] leading-none whitespace-nowrap">{type.label}</span>
          </button>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  /* Hide scrollbar but keep functionality */
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
  .scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }

  /* Safe area for devices with notches/home indicators */
  .pb-safe {
    padding-bottom: env(safe-area-inset-bottom);
  }
</style>
