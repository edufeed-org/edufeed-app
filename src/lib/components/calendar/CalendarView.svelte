<script>
  import { SvelteDate } from 'svelte/reactivity';
  import { onMount } from 'svelte';
  import { afterNavigate, replaceState } from '$app/navigation';
  import { formatDateParam } from '$lib/helpers/urlParams.js';
  import { page } from '$app/stores';
  import {
    communityCalendarTimelineLoader,
    createDateRangeCalendarLoader,
    createRelayFilteredCalendarLoader,
    calendarEventReferencesLoader
  } from '$lib/loaders/calendar.js';
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import { timedPool } from '$lib/loaders/base.js';
  import { calendarSearchLoader, MIN_QUERY_LENGTH } from '$lib/loaders/calendar-search.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import {
    getViewDateRange,
    filterEventsByViewMode,
    filterEventsBySelectedRelays
  } from '$lib/helpers/calendar.js';
  import { getCalendarRelays } from '$lib/helpers/relay-helper.js';
  import { relayUpdateSignal } from '$lib/services/app-relay-service.svelte.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { calendarFilters } from '$lib/stores/calendar-filters.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { GlobalCalendarEventModel } from '$lib/models/global-calendar-event.js';
  import { PersonalCalendarEventsModel, CalendarEventRangeModel } from '$lib/models';
  import {
    createUrlSyncHandler,
    syncInitialUrlState,
    useCalendarEventLoader
  } from '$lib/loaders/calendar-event-loader.svelte.js';
  import { prefetchCalendarData } from '$lib/loaders/calendar.js';
  import * as m from '$lib/paraglide/messages';

  // Import existing UI components
  import CalendarNavigation from '$lib/components/calendar/CalendarNavigation.svelte';
  import CalendarGrid from '$lib/components/calendar/CalendarGrid.svelte';
  import TopPublishersFilter from './TopPublishersFilter.svelte';
  import CalendarDropdown from './CalendarDropdown.svelte';
  import CalendarFilterBar from './CalendarFilterBar.svelte';
  import CalendarFilterDrawer from './CalendarFilterDrawer.svelte';
  import FeaturedAuthors from './FeaturedAuthors.svelte';
  import SimpleCalendarEventsList from './CalendarEventsList.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { parseDirectPubkeys } from '$lib/services/curated-authors-service.svelte.js';
  import AddToCalendarButton from './AddToCalendarButton.svelte';
  import CalendarMapView from './CalendarMapView.svelte';
  import CompactCommunityHeader from '$lib/components/community/layout/CompactCommunityHeader.svelte';

  /**
   * @typedef {import('$lib/types/calendar.js').CalendarEvent} CalendarEvent
   * @typedef {import('$lib/types/calendar.js').CalendarViewMode} CalendarViewMode
   */

  // Props
  let {
    communityPubkey = '',
    globalMode = false,
    calendar = null,
    rawCalendar = null,
    authorPubkey = '',
    communityMode = false,
    communityProfile = null
  } = $props();

  // Use reactive getter for active user to ensure proper reactivity on login/logout
  const getActiveUser = useActiveUser();
  let _activeUser = $derived(getActiveUser());

  // Calendar view state (local to this component)
  let currentDate = $state(new Date());
  let viewMode = $state(/** @type {CalendarViewMode} */ ('month'));
  let presentationViewMode = $state(/** @type {'calendar' | 'list' | 'map'} */ ('list'));

  // Drawer state
  let drawerOpen = $state(false); // Mobile drawer open state

  // Local component state (loader/model pattern)
  /**
   * @type {import("$lib/types/calendar.js").CalendarEvent[]}
   * Use $state.raw because events carry Symbol-based seen-relay metadata
   * that breaks under Svelte 5's deep proxies (see CLAUDE.md).
   */
  let allCalendarEvents = $state.raw(
    /** @type {import("$lib/types/calendar.js").CalendarEvent[]} */ ([])
  );
  let loading = $state(true);
  let minLoadTimeElapsed = $state(false);
  let error = $state(/** @type {string | null} */ (null));
  let _selectedCalendar = $state(calendarFilters.selectedCalendar);

  // Subscription management for loaders and models
  // Using plain let (not $state) for subscriptions to avoid infinite loops in $effect
  /** @type {import('rxjs').Subscription | undefined} */
  let calendarSubscription;
  /** @type {import('rxjs').Subscription | undefined} */
  let loaderSubscription;
  /** @type {import('rxjs').Subscription | undefined} */
  let modelSubscription;

  // Date range loading subscription (for global/author modes)
  /** @type {import('rxjs').Subscription | undefined} */
  let dateRangeLoaderSub;

  // Community mode specific state
  let resolutionErrors = $state(/** @type {string[]} */ ([]));

  // Guard to prevent effect from running before mount
  let mounted = $state(false);

  // Reactive check for relay availability - effects will wait until relays are configured
  // This resolves the race condition where effects run before config is initialized
  let relaysReady = $derived(getCalendarRelays().length > 0);

  // Track initial relays at component mount for supplemental loading pattern
  // When user override relays (kind 30002) arrive asynchronously, we detect and query them
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal tracking, not reactive state
  const initialCalendarRelays = new Set(getCalendarRelays());

  // Track previous community pubkey to detect actual changes
  let previousCommunityPubkey = $state('');

  // Initialize event loader composable for community mode
  const communityEventLoader = useCalendarEventLoader({
    onEventsUpdate: (events) => {
      allCalendarEvents = events;
    },
    onLoadingChange: (isLoading) => {
      loading = isLoading;
    },
    onError: (errorMsg) => {
      error = errorMsg;
    }
  });

  // Watch for communityPubkey changes and reload events
  $effect(() => {
    if (mounted && communityMode && communityPubkey) {
      // Only reload if the community actually changed
      if (communityPubkey !== previousCommunityPubkey) {
        previousCommunityPubkey = communityPubkey;
        // Use the event loader composable for community mode
        communityEventLoader.loadByCommunity(communityPubkey);
      }
    }
  });

  // Date range loading for globalMode/authorMode - reacts to currentDate and viewMode changes
  // This effect loads events for the visible date range using the calendar-relay's
  // special filter syntax (#start_after, #start_before) with fallback for other relays
  $effect(() => {
    // Subscribe to relay update signal via Svelte store auto-subscription ($storeName)
    // This ensures the effect re-runs when user relay overrides are loaded
    const _relaySignal = $relayUpdateSignal;

    // Only run for globalMode or authorPubkey modes
    if (!globalMode && !authorPubkey) return;
    // Skip if in community mode or using a specific calendar
    if (communityMode || calendar) return;
    // Wait for relays to be configured (resolves race condition with async config)
    if (!relaysReady) return;

    // Clean up previous date range subscription
    dateRangeLoaderSub?.unsubscribe();

    // Get authors filter - use authorPubkey if set, otherwise use effective
    // "people" filter (union of onlyFollowsMode pool, NIP-51 lists, and
    // individually picked authors).
    const authors = authorPubkey ? [authorPubkey] : calendarFilters.getEffectiveAuthorPubkeys();

    if (viewMode === 'all') {
      // 'all' view mode: No date filtering, use standard loader
      const relays = calendarFilters.selectedRelays;
      const loader = createRelayFilteredCalendarLoader(relays, { authors });
      dateRangeLoaderSub = loader().subscribe({
        error: (/** @type {any} */ err) => {
          console.error('📅 CalendarView: All events loader error:', err);
        },
        complete: () => {}
      });
    } else {
      // Date-filtered view: Use date range loader with NIP-52 filter syntax
      const { start, end } = getViewDateRange(currentDate, viewMode);

      // Read selectedRelays inside the effect so relay filter changes re-trigger it.
      const relays = calendarFilters.selectedRelays;

      const loader = createDateRangeCalendarLoader(
        { rangeStart: start, rangeEnd: end },
        { authors, relays }
      );
      dateRangeLoaderSub = loader().subscribe({
        error: (/** @type {any} */ err) => {
          console.error('📅 CalendarView: Date range loader error:', err);
        },
        complete: () => {}
      });
    }

    return () => {
      dateRangeLoaderSub?.unsubscribe();
    };
  });

  // Supplemental relay loading: when user override relays (kind 30002) arrive after
  // initial mount, this effect detects the new relays and queries them.
  // This pattern ensures we don't miss events from user-configured relays that
  // weren't available at initial load time.
  $effect(() => {
    // Subscribe to relay update signal to trigger re-runs when user overrides arrive
    // Svelte 5 doesn't auto-track reactive reads inside helper functions, so we need
    // this explicit subscription to know when userOverrideCache changes
    const _relaySignal = $relayUpdateSignal;

    // Only run for globalMode or authorPubkey modes (not community or specific calendar)
    if (!globalMode && !authorPubkey) return;
    if (communityMode || calendar) return;

    const currentRelays = getCalendarRelays();
    const newRelays = currentRelays.filter((r) => !initialCalendarRelays.has(r));

    if (newRelays.length === 0) return;

    // Add new relays to tracking set so we don't re-query them
    newRelays.forEach((r) => initialCalendarRelays.add(r));

    // Create a loader for just the new relays
    const loader = createTimelineLoader(
      timedPool,
      newRelays,
      { kinds: [31922, 31923], limit: 40 },
      { eventStore }
    );

    const sub = loader().subscribe({
      error: (/** @type {any} */ err) => {
        console.error('📅 CalendarView: Supplemental relay loader error:', err);
      }
    });

    return () => sub.unsubscribe();
  });

  // Reactive model subscription for globalMode/authorMode - reacts to date range changes
  // This effect uses CalendarEventRangeModel for date-filtered views (month/week/day)
  // and GlobalCalendarEventModel for 'all' view mode
  $effect(() => {
    // Only handle globalMode or authorPubkey modes
    if (!globalMode && !authorPubkey) return;
    // Skip if in community mode - that's handled by communityEventLoader
    if (communityMode) return;
    // Skip if using a specific calendar - that's handled by loadEvents()
    if (calendar) return;
    // Wait for relays to be configured
    if (!relaysReady) return;

    // Get authors filter (union via getEffectiveAuthorPubkeys to cover the
    // quick "only follows" toggle + NIP-51 lists + picked authors).
    const authors = authorPubkey ? [authorPubkey] : calendarFilters.getEffectiveAuthorPubkeys();

    // Clean up previous model subscription
    modelSubscription?.unsubscribe();

    if (viewMode === 'all') {
      // 'all' view: No date filtering, use GlobalCalendarEventModel
      modelSubscription = eventStore
        .model(GlobalCalendarEventModel, authors)
        .subscribe((/** @type {any} */ calendarEvents) => {
          allCalendarEvents = calendarEvents;
          loading = false;
        });
    } else {
      // Date-filtered view: Use CalendarEventRangeModel
      const { start, end } = getViewDateRange(currentDate, viewMode);
      modelSubscription = eventStore
        .model(CalendarEventRangeModel, start, end, authors)
        .subscribe((/** @type {any} */ calendarEvents) => {
          allCalendarEvents = calendarEvents;
          loading = false;
        });
    }

    return () => modelSubscription?.unsubscribe();
  });

  // NIP-50 full-text search: subscribe to the search loader whenever the query
  // meets the minimum length. Results are added to eventStore and surfaced via
  // the normal model subscriptions; no separate rendering path needed.
  /** @type {import('rxjs').Subscription | undefined} */
  let searchLoaderSub;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let searchDebounceTimer = null;
  $effect(() => {
    const q = calendarFilters.searchQuery.trim();
    searchLoaderSub?.unsubscribe();
    if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
    if (q.length < MIN_QUERY_LENGTH) return;

    // Debounce to avoid hammering relays while the user is still typing.
    searchDebounceTimer = setTimeout(() => {
      searchLoaderSub = calendarSearchLoader(q, {
        relays:
          calendarFilters.selectedRelays.length > 0 ? calendarFilters.selectedRelays : undefined
      }).subscribe({
        error: (/** @type {any} */ err) => {
          console.warn('📅 CalendarView: NIP-50 search loader error:', err);
        }
      });
    }, 350);

    return () => {
      if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
      searchLoaderSub?.unsubscribe();
    };
  });

  // Sync initial URL state on mount
  syncInitialUrlState(
    $page.url.searchParams,
    (/** @type {'calendar' | 'list' | 'map'} */ mode) => {
      presentationViewMode = mode;
    },
    (/** @type {CalendarViewMode} */ mode) => {
      viewMode = mode;
    },
    (/** @type {Date} */ date) => {
      currentDate = date;
    }
  );

  // Set up navigation listener - runs after every navigation
  afterNavigate(
    createUrlSyncHandler(
      (/** @type {'calendar' | 'list' | 'map'} */ mode) => {
        presentationViewMode = mode;
      },
      (/** @type {CalendarViewMode} */ mode) => {
        viewMode = mode;
      },
      (/** @type {Date} */ date) => {
        currentDate = date;
      }
    )
  );

  // State → URL: keep the viewed date shareable/reload-safe (#30). Uses
  // replaceState so calendar paging doesn't spam the history stack; the
  // param is omitted while the view sits on today (clean default URL).
  $effect(() => {
    const dateKey = formatDateParam(currentDate);
    if (typeof window === 'undefined') return;
    const next = dateKey === formatDateParam(new Date()) ? '' : dateKey;
    const url = new URL(window.location.href);
    if ((url.searchParams.get('date') || '') === next) return;
    if (next) url.searchParams.set('date', next);
    else url.searchParams.delete('date');
    try {
      replaceState(url, {});
    } catch {
      // Router not initialized yet (first paint) — the default URL is fine.
    }
  });

  // Get community profile for calendar title (when in communityMode)
  let getCommunityProfile = $derived.by(() => {
    if (communityMode && communityPubkey) {
      return useUserProfile(communityPubkey);
    }
    return null;
  });

  let communityProfileData = $derived.by(() => {
    if (getCommunityProfile) {
      return getCommunityProfile();
    }
    return null;
  });

  let communityCalendarTitle = $derived.by(() => {
    if (!communityProfileData) return 'Community Calendar';
    const displayName = communityProfileData.name || communityProfileData.display_name || '';
    return displayName ? `${displayName} Calendar` : 'Community Calendar';
  });

  /**
   * Load calendar events using direct loader/model pattern
   */
  function loadEvents() {
    // Global/author mode: loader and model subscriptions are fully managed
    // by reactive $effects that respond to viewMode, currentDate, and filter changes.
    // Do not interfere with effect-owned subscriptions here.
    if (globalMode || authorPubkey) return;

    // Clean up existing subscriptions (for community/calendar modes)
    loaderSubscription?.unsubscribe();
    modelSubscription?.unsubscribe();

    loading = true;
    allCalendarEvents = [];
    error = null;
    resolutionErrors = [];

    if (communityMode && communityPubkey) {
      // Community mode: Use the event loader composable
      communityEventLoader.loadByCommunity(communityPubkey);
    } else if (calendar && rawCalendar) {
      // Calendar mode: Load events from specific calendar
      loaderSubscription = calendarEventReferencesLoader(rawCalendar)().subscribe({
        error: (/** @type {any} */ err) => {
          console.error('📅 CalendarView: Calendar event references loader error:', err);
          error = err.message || 'Failed to load calendar events';
          loading = false;
        }
      });

      // Model: Use applesauce's CalendarEventsModel with raw calendar Event
      modelSubscription = eventStore
        .model(PersonalCalendarEventsModel, rawCalendar)
        .subscribe((/** @type {any} */ calendarEvents) => {
          allCalendarEvents = calendarEvents;
          loading = false;
        });
    } else {
      loading = false;
    }
  }

  /**
   * Refresh calendar events
   * @param {string[]} [relays] - Optional relay filters to apply
   */
  function handleRefresh(relays) {
    if (relays) {
      calendarFilters.selectedRelays = relays;
    }
    loadEvents();
  }

  onMount(() => {
    // Set mounted flag to allow effects to run
    mounted = true;

    // Pre-warm relay capabilities cache and start background timeline loader
    prefetchCalendarData();

    // Start timer for delayed empty state — prevents "no events" flash on first load
    const emptyStateTimer = setTimeout(() => {
      minLoadTimeElapsed = true;
    }, 3000);

    // Bootstrap EventStore with appropriate loader (unless in community mode)
    if (communityMode && communityPubkey) {
      // Bootstrap EventStore with community calendar loader
      communityCalendarTimelineLoader(communityPubkey)().subscribe({
        error: (/** @type {any} */ err) => {
          console.warn('📅 CalendarView: Community calendar loader bootstrap error:', err);
        }
      });
    }

    // Subscribe to calendar selection changes (only when no calendar prop provided)
    if (!calendar) {
      calendarSubscription = calendarFilters.selectedCalendar$.subscribe((cal) => {
        _selectedCalendar = cal;
      });
    }

    // Load events on mount based on initial state
    handleRefresh();

    // Cleanup subscriptions on unmount
    return () => {
      clearTimeout(emptyStateTimer);
      calendarSubscription?.unsubscribe();
      loaderSubscription?.unsubscribe();
      modelSubscription?.unsubscribe();
      dateRangeLoaderSub?.unsubscribe();
      searchLoaderSub?.unsubscribe();
      if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
      communityEventLoader.cleanup();
    };
  });

  function handlePrevious() {
    const newDate = new SvelteDate(currentDate);
    switch (viewMode) {
      case 'month':
        newDate.setMonth(newDate.getMonth() - 1);
        break;
      case 'week':
        newDate.setDate(newDate.getDate() - 7);
        break;
      case 'day':
        newDate.setDate(newDate.getDate() - 1);
        break;
    }
    currentDate = newDate;
  }

  function handleNext() {
    const newDate = new SvelteDate(currentDate);
    switch (viewMode) {
      case 'month':
        newDate.setMonth(newDate.getMonth() + 1);
        break;
      case 'week':
        newDate.setDate(newDate.getDate() + 7);
        break;
      case 'day':
        newDate.setDate(newDate.getDate() + 1);
        break;
    }
    currentDate = newDate;
  }

  function handleToday() {
    currentDate = new Date();
  }

  /**
   * @param {CalendarViewMode} newViewMode
   */
  function handleViewModeChange(newViewMode) {
    viewMode = newViewMode;
  }

  /**
   * @param {'calendar' | 'list' | 'map'} newPresentationViewMode
   */
  function handlePresentationViewModeChange(newPresentationViewMode) {
    // NOTE: This function is no longer called from CalendarNavigation
    // All state updates now flow through URL → useCalendarUrlSync → callbacks
    // Keeping this function for backwards compatibility with other potential callers
    presentationViewMode = newPresentationViewMode;
  }

  /**
   * @param {Date} date
   */
  function handleDateClick(date) {
    currentDate = new Date(date);
    viewMode = 'day';
  }

  /**
   * @param {CalendarEvent} event
   */
  function handleEventClick(event) {
    modalStore.openModal('eventDetails', { event });
  }

  // Relay, tag, search, and follow-list filter changes are all driven by
  // `calendarFilters` store writes from the selector components. The loader
  // and model $effects above read the store reactively, so they re-run
  // automatically — no imperative refresh needed.
  /** @param {string[]} _relays */
  function handleRelayFilterChange(_relays) {}
  /** @param {string[]} _tags */
  function handleTagFilterChange(_tags) {}
  /** @param {string} _query */
  function handleSearchQueryChange(_query) {}

  function handleClearAllFilters() {
    calendarFilters.clearSelectedTags();
    calendarFilters.clearSelectedRelays();
    calendarFilters.clearSelectedFollowListIds();
    calendarFilters.clearSelectedFeaturedAuthors();
    calendarFilters.clearSearchQuery();
    calendarFilters.setOnlyFollowsMode('off');
    calendarFilters.clearHiddenAuthors();
  }

  // No-op handler passed to the new filter bar/drawer — filter state changes
  // flow through the store, so the loader/model effects pick them up directly.
  function handlePeopleChange() {}

  // Create derived state for proper reactivity tracking
  let selectedTags = $derived(calendarFilters.selectedTags);
  let searchQuery = $derived(calendarFilters.searchQuery);

  const featuredAuthorsHex = $derived(
    parseDirectPubkeys(runtimeConfig.calendar?.featuredAuthors || [])
  );
  let selectedFeaturedAuthors = $derived(calendarFilters.selectedFeaturedAuthors);
  // drawerOpen already exists — reuse, do NOT redeclare
  const activeFilterCount = $derived(
    calendarFilters.selectedTags.length +
      calendarFilters.selectedRelays.length +
      calendarFilters.selectedFollowListIds.length +
      calendarFilters.selectedFeaturedAuthors.length +
      calendarFilters.hiddenAuthorPubkeys.length +
      (calendarFilters.searchQuery.trim() ? 1 : 0) +
      (calendarFilters.onlyFollowsMode !== 'off' ? 1 : 0)
  );
  const anyFilterActive = $derived(activeFilterCount > 0);

  // Batch-load profiles for the current event set so author-name search can
  // match display names without per-event hook calls.
  const searchProfiles = useProfileMap(() => allCalendarEvents.map((e) => e.pubkey));

  // Derived state: Apply relay filtering via seen-relay post-filter.
  // The loader only queries selected relays, but EventStore may still contain
  // events fetched earlier from other relays — this keeps the displayed set
  // consistent with the user's relay selection.
  let events = $derived(
    filterEventsBySelectedRelays(allCalendarEvents, calendarFilters.selectedRelays)
  );

  // Client-side filtering with tag buttons (OR logic) + text search (AND logic)
  let displayedEvents = $derived.by(() => {
    let filtered = events; // Models now emit pre-validated events

    // Step 1: Apply tag filtering (OR logic)
    if (selectedTags.length > 0) {
      filtered = filtered.filter((event) => {
        // Normalize event hashtags to lowercase for case-insensitive matching
        const normalizedHashtags = (event.hashtags || []).map((/** @type {any} */ tag) =>
          tag.toLowerCase().trim()
        );

        // Check if event has any of the selected tags
        return selectedTags.some((/** @type {any} */ tag) => normalizedHashtags.includes(tag));
      });
    }

    // Step 2: Apply text search (AND logic with tags). Matches across title,
    // description, location, hashtags, and resolved author display name.
    const query = searchQuery.trim();
    if (query) {
      const lowerQuery = query.toLowerCase();
      filtered = filtered.filter((event) => {
        const titleMatch = event.title?.toLowerCase().includes(lowerQuery);
        const descMatch = /** @type {any} */ (event).description
          ?.toLowerCase()
          .includes(lowerQuery);
        const locationMatch = /** @type {any} */ (event).location
          ?.toLowerCase()
          .includes(lowerQuery);
        const tagMatch = event.hashtags?.some((tag) => tag.toLowerCase().includes(lowerQuery));
        const profile = searchProfiles().get(event.pubkey);
        const authorName = (profile?.name || profile?.display_name || '').toLowerCase();
        const authorMatch = authorName.includes(lowerQuery);
        return titleMatch || descMatch || locationMatch || tagMatch || authorMatch;
      });
    }

    // Step 3: Apply featured-authors filtering (AND logic)
    if (selectedFeaturedAuthors.length > 0) {
      filtered = filtered.filter((event) => selectedFeaturedAuthors.includes(event.pubkey));
    }

    return filtered;
  });

  // Top-publisher chips derive from the view-scoped set BEFORE hidden
  // authors are removed, so a hidden publisher keeps its chip (issue #28).
  let eventsInViewPreHide = $derived(
    filterEventsByViewMode(displayedEvents, viewMode, currentDate)
  );

  // Step 4: hide events from publishers the user toggled off.
  let visibleEvents = $derived(
    calendarFilters.hiddenAuthorPubkeys.length > 0
      ? displayedEvents.filter(
          (event) => !calendarFilters.hiddenAuthorPubkeys.includes(event.pubkey)
        )
      : displayedEvents
  );

  // Events scoped to the currently rendered time range — used for the header
  // event count so it matches what the list/grid actually shows. In 'all'
  // mode this is identical to visibleEvents.
  let displayedEventsInView = $derived(
    filterEventsByViewMode(visibleEvents, viewMode, currentDate)
  );
</script>

<div class="flex flex-col gap-2 py-4">
  {#if communityMode && communityProfile && communityPubkey}
    <div class="container mx-auto px-4">
      <CompactCommunityHeader {communityProfile} {communityPubkey} />
    </div>
  {/if}

  <!-- Chrome bar: picker + filters + navigation wrapped in single bordered block -->
  <div class="border-b border-base-300">
    <!-- Unified header row: calendar picker + inline filters (lg+) or mobile drawer trigger -->
    <div
      data-testid="calendar-chrome-row"
      class="container mx-auto flex flex-wrap items-center gap-2 px-4 py-2"
    >
      {#if !communityMode}
        <CalendarDropdown currentCalendar={calendar} />
        <!-- Desktop inline filter bar (takes remaining space) -->
        <div class="hidden grow lg:block">
          <CalendarFilterBar
            validEvents={events}
            featuredAuthors={featuredAuthorsHex}
            onRelayFilterChange={handleRelayFilterChange}
            onSearchQueryChange={handleSearchQueryChange}
            onTagFilterChange={handleTagFilterChange}
            onPeopleChange={handlePeopleChange}
            onClearAll={handleClearAllFilters}
          />
        </div>
        <!-- Mobile filter drawer trigger -->
        <button
          type="button"
          class="btn ms-auto gap-1 btn-ghost btn-sm lg:hidden"
          onclick={() => (drawerOpen = true)}
        >
          Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
      {:else}
        <h2 class="text-lg font-semibold text-base-content">
          {m.calendar_view_community_calendar()}
        </h2>
        {#if communityPubkey}
          <AddToCalendarButton
            calendarId={communityPubkey}
            calendarTitle={communityCalendarTitle}
          />
        {/if}
      {/if}
    </div>

    <!-- Featured authors rail (only when no filters are active) -->
    {#if !communityMode && featuredAuthorsHex.length > 0 && !anyFilterActive}
      <div class="container mx-auto px-4">
        <FeaturedAuthors
          pubkeys={featuredAuthorsHex}
          selected={selectedFeaturedAuthors}
          onToggle={(pk) =>
            selectedFeaturedAuthors.includes(pk)
              ? calendarFilters.removeFeaturedAuthor(pk)
              : calendarFilters.addFeaturedAuthor(pk)}
          variant="rail"
        />
      </div>
    {/if}

    <!-- Error Display -->
    {#if error}
      <div class="container mx-auto px-4">
        <div class="alert rounded-none border-b border-error/20 px-6 py-3 alert-error">
          <div class="flex items-center gap-3">
            <svg class="h-5 w-5 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span class="flex-1 text-sm">{error}</span>
            <button
              class="btn btn-ghost btn-xs"
              onclick={() => (error = null)}
              aria-label={m.calendar_view_dismiss_error()}
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Resolution Errors Display (community mode) -->
    {#if communityMode && resolutionErrors.length > 0}
      <div class="container mx-auto px-4">
        <div class="alert rounded-none border-b border-warning/20 px-6 py-3 alert-warning">
          <div class="flex items-start gap-3">
            <svg
              class="mt-0.5 h-5 w-5 text-warning"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
            <div class="flex-1">
              <h4 class="mb-1 text-sm font-medium">{m.calendar_view_resolution_error_title()}</h4>
              <p class="mb-2 text-xs text-base-content/70">
                {m.calendar_view_resolution_error_desc({
                  count: resolutionErrors.length,
                  plural: resolutionErrors.length === 1 ? '' : 's',
                  n: resolutionErrors.length
                })}
              </p>
              <details class="text-xs">
                <summary class="cursor-pointer hover:text-base-content"
                  >{m.calendar_view_show_details()}</summary
                >
                <ul class="mt-2 space-y-1">
                  {#each resolutionErrors as errorMsg, index (index)}
                    <li class="text-base-content/60">• {errorMsg}</li>
                  {/each}
                </ul>
              </details>
            </div>
            <button
              class="btn btn-ghost btn-xs"
              onclick={() => (resolutionErrors = [])}
              aria-label={m.calendar_view_dismiss_resolution()}
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Calendar Navigation -->
    <div class="container mx-auto px-4">
      <CalendarNavigation
        {currentDate}
        {viewMode}
        {presentationViewMode}
        {communityMode}
        eventCount={displayedEventsInView.length}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onToday={handleToday}
        onViewModeChange={handleViewModeChange}
        onPresentationViewModeChange={handlePresentationViewModeChange}
      />
    </div>
  </div>

  <!-- Content based on presentation view mode -->
  <div class="container mx-auto px-4">
    <TopPublishersFilter events={eventsInViewPreHide} />

    {#if presentationViewMode === 'calendar'}
      <CalendarGrid
        {currentDate}
        {viewMode}
        events={visibleEvents}
        onEventClick={handleEventClick}
        onDateClick={handleDateClick}
      />
    {:else if presentationViewMode === 'list'}
      <SimpleCalendarEventsList events={visibleEvents} {viewMode} {currentDate} {loading} {error} />
    {:else if presentationViewMode === 'map'}
      <CalendarMapView events={visibleEvents} {viewMode} {currentDate} />
    {/if}
  </div>

  <!-- Loading indicator -->
  {#if loading || (events.length === 0 && !minLoadTimeElapsed)}
    <div class="container mx-auto px-4">
      <div class="border-b border-base-300 px-6 py-3 text-center">
        <div class="flex items-center justify-center gap-3">
          <div class="loading loading-sm loading-spinner"></div>
          <div class="text-sm text-base-content/70">
            {#if events.length === 0}
              {m.calendar_view_loading_events()}
            {:else}
              {m.calendar_view_loading_more({ count: events.length })}
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Empty State -->
  {#if events.length === 0 && !loading && minLoadTimeElapsed}
    <div class="container mx-auto px-4">
      <div class="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div class="mb-4 text-base-content/30">
          <svg class="h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
        <h3 class="mb-2 text-lg font-medium text-base-content">
          {globalMode
            ? m.calendar_view_empty_global_title()
            : m.calendar_view_empty_community_title()}
        </h3>
        <p class="mb-6 max-w-md text-base-content/60">
          {#if globalMode}
            {m.calendar_view_empty_global_desc()}
          {:else}
            {m.calendar_view_empty_community_desc()}
          {/if}
        </p>
      </div>
    </div>
  {/if}

  <!-- Mobile filter drawer -->
  {#if !communityMode}
    <CalendarFilterDrawer
      isDrawerOpen={drawerOpen}
      validEvents={events}
      featuredAuthors={featuredAuthorsHex}
      {activeFilterCount}
      onRelayFilterChange={handleRelayFilterChange}
      onSearchQueryChange={handleSearchQueryChange}
      onTagFilterChange={handleTagFilterChange}
      onPeopleChange={handlePeopleChange}
      onClose={() => (drawerOpen = false)}
    />
  {/if}
</div>
