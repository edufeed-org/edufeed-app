<!--
  CalendarNavigation Component
  Navigation controls for calendar view switching and date navigation
-->

<script>
  import { SvelteDate } from 'svelte/reactivity';
  import * as m from '$lib/paraglide/messages';
  import { page } from '$app/stores';
  import { formatCalendarDate } from '../../helpers/calendar.js';
  import { updateQueryParams } from '../../helpers/urlParams.js';
  import AddToCalendarButton from './AddToCalendarButton.svelte';

  import {
    ChevronLeftIcon,
    ChevronRightIcon,
    CalendarIcon,
    MenuIcon,
    LocationIcon
  } from '../icons';

  /**
   * @typedef {import('../../types/calendar.js').CalendarViewMode} CalendarViewMode
   * @typedef {'calendar' | 'list' | 'map'} PresentationViewMode
   */

  // Props using Svelte 5 runes
  let {
    currentDate,
    viewMode,
    presentationViewMode = 'calendar',
    communityMode = false,
    eventCount = 0,
    onPrevious = /** @type {() => void} */ (() => {}),
    onNext = /** @type {() => void} */ (() => {}),
    onToday = /** @type {() => void} */ (() => {}),
    onViewModeChange: _onViewModeChange,
    onPresentationViewModeChange: _onPresentationViewModeChange = () => {}
  } = $props();

  // Format current date for display based on view mode
  let displayDate = $derived(getDisplayDate(currentDate, viewMode));

  /**
   * Get formatted date string for current view
   * @param {Date} date
   * @param {CalendarViewMode} mode
   * @returns {string}
   */
  function getDisplayDate(date, mode) {
    switch (mode) {
      case 'all':
        return m.calendar_navigation_all_events();
      case 'month':
        return formatCalendarDate(date, 'month');
      case 'week': {
        // Show week range
        const startOfWeek = new SvelteDate(date);
        startOfWeek.setDate(date.getDate() - date.getDay());
        const endOfWeek = new SvelteDate(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);

        if (startOfWeek.getMonth() === endOfWeek.getMonth()) {
          return `${formatCalendarDate(startOfWeek, 'short')} - ${endOfWeek.getDate()}, ${endOfWeek.getFullYear()}`;
        } else {
          return `${formatCalendarDate(startOfWeek, 'short')} - ${formatCalendarDate(endOfWeek, 'short')}`;
        }
      }
      case 'day':
        return formatCalendarDate(date, 'full');
      default:
        return formatCalendarDate(date, 'full');
    }
  }

  /**
   * Handle view mode button click
   * @param {CalendarViewMode} mode
   */
  function handleViewModeClick(mode) {
    console.log('🔄 handleViewModeClick called with mode:', mode);

    // Update URL with new period - let useCalendarUrlSync handle state updates
    updateQueryParams($page.url.searchParams, {
      period: mode === 'month' ? null : mode // Don't include 'month' as it's the default
    });

    // NOTE: Don't call _onViewModeChange here - let URL sync effect handle it
    // This prevents race conditions between async URL updates and sync callbacks
    console.log('✅ URL updated, waiting for sync effect');
  }

  /**
   * Handle previous button click
   */
  function handlePreviousClick() {
    console.log('🔄 Previous button clicked');
    onPrevious();
    console.log('✅ onPrevious callback completed');
  }

  /**
   * Handle next button click
   */
  function handleNextClick() {
    console.log('🔄 Next button clicked');
    onNext();
    console.log('✅ onNext callback completed');
  }

  /**
   * Handle today button click
   */
  function handleTodayClick() {
    console.log('🔄 Today button clicked');
    onToday();
    console.log('✅ onToday callback completed');
  }

  /**
   * Handle presentation view mode button click
   * @param {PresentationViewMode} mode
   */
  function handlePresentationViewModeClick(mode) {
    // Always include `view` in the URL. The loader's URL-sync handler defaults
    // to 'list' when absent, so we must set it explicitly for every mode —
    // otherwise 'calendar' (grid) clicks would be swallowed as the default.
    // NOTE: Don't call _onPresentationViewModeChange here — let the URL sync
    // effect handle it to avoid races between async URL updates and sync callbacks.
    updateQueryParams($page.url.searchParams, { view: mode });
  }
</script>

<div>
  <!-- Mobile Layout (< lg) -->
  <div class="flex flex-col gap-3 p-3 lg:hidden">
    <!-- Row 1: Date navigation and current date -->
    <div class="flex items-center gap-2">
      <!-- Date Navigation - Hidden in 'all' mode -->
      {#if viewMode !== 'all'}
        <div class="flex flex-1 items-center justify-between gap-2">
          <button
            class="btn btn-outline btn-sm"
            onclick={handlePreviousClick}
            aria-label={m.calendar_navigation_previous({ viewMode })}
          >
            <ChevronLeftIcon class_="w-5 h-5" />
          </button>

          <button class="btn btn-sm btn-primary" onclick={handleTodayClick}
            >{m.common_today()}</button
          >

          <button
            class="btn btn-outline btn-sm"
            onclick={handleNextClick}
            aria-label={m.calendar_navigation_next({ viewMode })}
          >
            <ChevronRightIcon class_="w-5 h-5" />
          </button>
        </div>
      {:else}
        <div class="flex-1 text-center text-lg font-semibold text-base-content">
          {m.calendar_navigation_all_events()}
        </div>
      {/if}

      <!-- Add Calendar Button -->
      {#if !communityMode && !$page.url.pathname.endsWith('/calendar')}
        <AddToCalendarButton />
      {/if}
    </div>

    <!-- Row 2: Current Date Display (only if not in 'all' mode) -->
    {#if viewMode !== 'all'}
      <div class="text-center text-base font-semibold text-base-content">
        {displayDate}
      </div>
    {/if}

    <!-- Row 3: View Mode Selectors -->
    <div class="flex items-center justify-center gap-2">
      <!-- Presentation View Selector -->
      <div class="join join-horizontal">
        <button
          class="btn join-item btn-sm"
          class:btn-outline={presentationViewMode !== 'calendar'}
          class:btn-primary={presentationViewMode === 'calendar'}
          onclick={() => handlePresentationViewModeClick('calendar')}
          title={m.calendar_navigation_calendar_grid_view()}
          aria-label={m.calendar_navigation_calendar_grid_view()}
          aria-pressed={presentationViewMode === 'calendar'}
        >
          <CalendarIcon class_="w-4 h-4" />
        </button>
        <button
          class="btn join-item btn-sm"
          class:btn-outline={presentationViewMode !== 'list'}
          class:btn-primary={presentationViewMode === 'list'}
          onclick={() => handlePresentationViewModeClick('list')}
          title={m.calendar_navigation_list_view()}
          aria-label={m.calendar_navigation_list_view()}
          aria-pressed={presentationViewMode === 'list'}
        >
          <MenuIcon class_="w-4 h-4" />
        </button>
        <button
          class="btn join-item btn-sm"
          class:btn-outline={presentationViewMode !== 'map'}
          class:btn-primary={presentationViewMode === 'map'}
          onclick={() => handlePresentationViewModeClick('map')}
          title={m.calendar_navigation_map_view()}
          aria-label={m.calendar_navigation_map_view()}
          aria-pressed={presentationViewMode === 'map'}
        >
          <LocationIcon class_="w-4 h-4" />
        </button>
      </div>

      <!-- Calendar View Mode Selector -->
      <div class="join join-horizontal">
        {#if presentationViewMode === 'list'}
          <button
            class="btn join-item btn-sm"
            class:btn-outline={viewMode !== 'all'}
            class:btn-primary={viewMode === 'all'}
            onclick={() => handleViewModeClick('all')}
          >
            {m.common_all()}
          </button>
        {/if}
        <button
          class="btn join-item btn-sm"
          class:btn-outline={viewMode !== 'month'}
          class:btn-primary={viewMode === 'month'}
          onclick={() => handleViewModeClick('month')}
        >
          {m.common_month()}
        </button>
        <button
          class="btn join-item btn-sm"
          class:btn-outline={viewMode !== 'week'}
          class:btn-primary={viewMode === 'week'}
          onclick={() => handleViewModeClick('week')}
        >
          {m.common_week()}
        </button>
        <button
          class="btn join-item btn-sm"
          class:btn-outline={viewMode !== 'day'}
          class:btn-primary={viewMode === 'day'}
          onclick={() => handleViewModeClick('day')}
        >
          {m.common_day()}
        </button>
      </div>
    </div>
  </div>

  <!-- Desktop Layout (>= lg) -->
  <div class="hidden flex-wrap items-center gap-2 p-3 lg:flex">
    <!-- Date Navigation - Hidden in 'all' mode -->
    {#if viewMode !== 'all'}
      <div class="flex items-center gap-2">
        <div class="join">
          <button
            class="btn join-item btn-sm"
            onclick={handlePreviousClick}
            aria-label={m.calendar_navigation_previous({ viewMode })}
          >
            <ChevronLeftIcon class_="w-4 h-4" />
          </button>
          <button class="btn join-item btn-sm btn-primary" onclick={handleTodayClick}
            >{m.common_today()}</button
          >
          <button
            class="btn join-item btn-sm"
            onclick={handleNextClick}
            aria-label={m.calendar_navigation_next({ viewMode })}
          >
            <ChevronRightIcon class_="w-4 h-4" />
          </button>
        </div>

        <div class="min-w-0 text-base font-semibold whitespace-nowrap text-base-content">
          {displayDate} <span class="font-normal text-base-content/60">· {eventCount} Events</span>
        </div>
      </div>
    {:else}
      <!-- In 'all' mode, show a simple heading instead -->
      <div class="text-base font-semibold text-base-content">
        {m.calendar_navigation_all_events()}
        <span class="font-normal text-base-content/60">· {eventCount} Events</span>
      </div>
    {/if}

    <!-- Right-aligned controls -->
    <div class="ms-auto flex items-center gap-2">
      <!-- Presentation View Selector -->
      <div class="join">
        <button
          class="btn join-item btn-sm"
          class:btn-outline={presentationViewMode !== 'calendar'}
          class:btn-primary={presentationViewMode === 'calendar'}
          onclick={() => handlePresentationViewModeClick('calendar')}
          title={m.calendar_navigation_calendar_grid_view()}
          aria-label={m.calendar_navigation_calendar_grid_view()}
          aria-pressed={presentationViewMode === 'calendar'}
        >
          <CalendarIcon class_="w-4 h-4" />
        </button>
        <button
          class="btn join-item btn-sm"
          class:btn-outline={presentationViewMode !== 'list'}
          class:btn-primary={presentationViewMode === 'list'}
          onclick={() => handlePresentationViewModeClick('list')}
          title={m.calendar_navigation_list_view()}
          aria-label={m.calendar_navigation_list_view()}
          aria-pressed={presentationViewMode === 'list'}
        >
          <MenuIcon class_="w-4 h-4" />
        </button>
        <button
          class="btn join-item btn-sm"
          class:btn-outline={presentationViewMode !== 'map'}
          class:btn-primary={presentationViewMode === 'map'}
          onclick={() => handlePresentationViewModeClick('map')}
          title={m.calendar_navigation_map_view()}
          aria-label={m.calendar_navigation_map_view()}
          aria-pressed={presentationViewMode === 'map'}
        >
          <LocationIcon class_="w-4 h-4" />
        </button>
      </div>

      <!-- Calendar View Mode Selector -->
      <div class="join">
        {#if presentationViewMode === 'list'}
          <button
            class="btn join-item btn-sm"
            class:btn-outline={viewMode !== 'all'}
            class:btn-primary={viewMode === 'all'}
            onclick={() => handleViewModeClick('all')}
          >
            {m.common_all()}
          </button>
        {/if}
        <button
          class="btn join-item btn-sm"
          class:btn-outline={viewMode !== 'month'}
          class:btn-primary={viewMode === 'month'}
          onclick={() => handleViewModeClick('month')}
        >
          {m.common_month()}
        </button>
        <button
          class="btn join-item btn-sm"
          class:btn-outline={viewMode !== 'week'}
          class:btn-primary={viewMode === 'week'}
          onclick={() => handleViewModeClick('week')}
        >
          {m.common_week()}
        </button>
        <button
          class="btn join-item btn-sm"
          class:btn-outline={viewMode !== 'day'}
          class:btn-primary={viewMode === 'day'}
          onclick={() => handleViewModeClick('day')}
        >
          {m.common_day()}
        </button>
      </div>
      {#if !communityMode && !$page.url.pathname.endsWith('/calendar')}
        <AddToCalendarButton />
      {/if}
    </div>
  </div>
</div>
