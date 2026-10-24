<script>
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { SvelteSet } from 'svelte/reactivity';
  import { untrack } from 'svelte';
  import { createArticleFeed } from '$lib/loaders/articles.js';
  import { createAmbFeed } from '$lib/loaders/amb.js';
  import { createKanbanFeed } from '$lib/loaders/kanban.js';
  import {
    createDateRangeCalendarLoader,
    createPaginatedCalendarLoader
  } from '$lib/loaders/calendar.js';
  import { preWarmRelayCapabilitiesCache } from '$lib/services/relay-capabilities.js';
  import { fetchEvents } from '$lib/loaders/base.js';
  import { createEmptyFilters } from '$lib/helpers/educational/searchQueryBuilder.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import {
    getEducationalRelays,
    getArticleRelays,
    getCalendarRelays,
    getKanbanRelays
  } from '$lib/helpers/relay-helper.js';
  import { TimelineModel } from 'applesauce-core/models';
  import { AMBResourceModel, CalendarEventRangeModel } from '$lib/models';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useAuthorDeletions } from '$lib/stores/author-deletions.svelte.js';
  import { useDiscoverFeeds } from '$lib/stores/discover-feeds.svelte.js';
  import { useLearningSearch } from '$lib/stores/learning-search.svelte.js';
  import { useCommunityScopedItems } from '$lib/stores/community-scoped-items.svelte.js';
  import { getTagValue } from 'applesauce-core/helpers';
  import { withoutPlaceholderBoards } from '$lib/helpers/kanban-boards.js';
  import CreateBoardLink from '$lib/components/kanban/CreateBoardLink.svelte';
  import { getAppRelaysForCategory } from '$lib/services/app-relay-service.svelte.js';
  import {
    applyCuratedFilter,
    isAllowedAuthor,
    getCuratedCacheVersion,
    getCuratedAuthors
  } from '$lib/services/curated-authors-service.svelte.js';
  import PeopleResults from '$lib/components/discover/PeopleResults.svelte';
  import DiscoverHero from '$lib/components/discover/DiscoverHero.svelte';
  import DiscoverTabs from '$lib/components/discover/DiscoverTabs.svelte';
  import DiscoverSearchBar from '$lib/components/discover/DiscoverSearchBar.svelte';
  import DiscoverFilterBar from '$lib/components/discover/DiscoverFilterBar.svelte';
  import DiscoverFeedGrid from '$lib/components/discover/DiscoverFeedGrid.svelte';
  import CommunitiesTab from '$lib/components/discover/CommunitiesTab.svelte';
  import { timer, debounceTime } from 'rxjs';
  import { takeUntil } from 'rxjs/operators';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { updateQueryParams, parseFeedFilters } from '$lib/helpers/urlParams.js';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
  import { useJoinedCommunitiesState } from '$lib/stores/joined-communities-list.svelte.js';
  import {
    useAllCommunities,
    useAllCommunitiesLoaded
  } from '$lib/stores/all-communities.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import {
    getCommunityFilterOptions,
    hasDisplayableCommunityProfile
  } from '$lib/helpers/communityContent.js';
  import {
    buildRawItems,
    buildCommunityRawItems,
    filterByRelay,
    filterByAuthors,
    filterBySearch,
    resolveSortBy,
    sortItems,
    joinedFilterState
  } from '$lib/helpers/discover-pipeline.js';
  import * as m from '$lib/paraglide/messages';
  import {
    DISCOVER_CONTENT_TYPES,
    DISCOVER_FEED_TYPES,
    getDiscoverTabs,
    resolveDiscoverType,
    isDiscoverTypeEnabled
  } from '$lib/helpers/discover-content-types.js';

  // ─── Deployment config ────────────────────────────────────────────────
  // Content types this deployment offers (DISCOVER_CONTENT_TYPES → runtimeConfig).
  // Read once at mount: the root layout resolves /api/config before any page
  // renders, and a deployment setting never changes at runtime.
  const enabledContentTypes = runtimeConfig.discover?.contentTypes || [...DISCOVER_CONTENT_TYPES];
  // Tabs to render. "all" leads only when it merges ≥2 feed types.
  const discoverTabs = getDiscoverTabs(enabledContentTypes);
  const defaultContentType = resolveDiscoverType(null, discoverTabs);
  const hasAnyFeedType = DISCOVER_FEED_TYPES.some((t) =>
    isDiscoverTypeEnabled(t, enabledContentTypes)
  );
  /** @param {string} type */
  function isEnabled(type) {
    return isDiscoverTypeEnabled(type, enabledContentTypes);
  }

  const DISPLAY_BATCH = 20;
  const CALENDAR_BATCH_SIZE = 20; // Events per calendar pagination batch
  const BATCH_TIMEOUT = 4_000; // Safety timeout per calendar batch (timedPool + buffer)
  const DEFAULT_RANGE_SECONDS = 90 * 24 * 60 * 60; // Events tab default: now to +3 months

  // ─── URL + tab/filter state ───────────────────────────────────────────
  const initialFilters = parseFeedFilters($page.url.searchParams);

  // Unknown or disabled types fall back to the default tab
  let contentType = $state(resolveDiscoverType(initialFilters.type, discoverTabs));
  let sortBy = $state('newest');
  let searchQuery = $state(initialFilters.search || '');
  // Active search query (set on Enter / search button / debounce)
  let activeSearchQuery = $state(initialFilters.search || '');
  let communityFilter = $state(/** @type {string | null} */ (initialFilters.community));
  let relayFilter = $state(/** @type {string | null} */ (null));
  /** @type {string[]} multi-author filter (hex pubkeys) */
  let authorFilter = $state(initialFilters.author);
  let eventsDateRangeStart = $state(initialFilters.eventStart ?? Math.floor(Date.now() / 1000));
  let eventsDateRangeEnd = $state(
    initialFilters.eventEnd ?? Math.floor(Date.now() / 1000) + DEFAULT_RANGE_SECONDS
  );
  // Learning SKOS filters (kept to rebuild the search when the text changes)
  /** @type {import('$lib/helpers/educational/searchQueryBuilder.js').SearchFilters} */
  let learningFilters = $state(createEmptyFilters());

  /**
   * Whether items of `type` belong on the current tab: the tab itself, or the
   * "all" feed when the type is enabled for this deployment.
   * @param {string} type
   */
  function showsType(type) {
    return contentType === type || (contentType === 'all' && isEnabled(type));
  }

  // Relay filter: map current tab to relay category
  const tabRelayCategory = $derived(
    contentType === 'events'
      ? 'calendar'
      : contentType === 'learning'
        ? 'educational'
        : contentType === 'articles'
          ? 'longform'
          : contentType === 'boards'
            ? 'kanban'
            : null
  );
  const availableRelays = $derived(
    tabRelayCategory ? getAppRelaysForCategory(tabRelayCategory) : []
  );

  let activeUser = $state(manager.active);
  $effect(() => {
    const subscription = manager.active$.subscribe((user) => {
      activeUser = user;
    });
    return () => subscription.unsubscribe();
  });

  // ─── Sources: model mirrors ───────────────────────────────────────────
  // $state.raw: Nostr events carry Symbol-based relay provenance that a deep
  // proxy breaks; the arrays are always replaced wholesale.
  let articles = $state.raw(/** @type {any[]} */ ([]));
  let ambResources = $state.raw(/** @type {any[]} */ ([]));
  let calendarEvents = $state.raw(/** @type {any[]} */ ([]));
  let kanbanBoards = $state.raw(/** @type {any[]} */ ([]));
  // Trigger counter so the profile/deletion getters re-run when the raw arrays are replaced
  let profileTrigger = $state(0);

  // Cleared by the first feed settle / model emission / calendar completion;
  // with no feed type enabled nothing would ever clear it, so start false.
  let isLoading = $state(hasAnyFeedType);
  let displayLimit = $state(DISPLAY_BATCH);
  let hasMoreCalendarEvents = $state(true);
  let calendarLoadingMore = $state(false);

  // ─── Hooks ────────────────────────────────────────────────────────────
  // Community hooks
  // With status: the "My communities" filter must tell a list that is still
  // loading (or failed to load) from a user who has joined nothing.
  const joinedState = useJoinedCommunitiesState();
  const getAllCommunities = useAllCommunities();
  const getCommunitiesLoaded = useAllCommunitiesLoaded();
  const joinedCommunities = $derived(joinedState.list());
  const joinedStatus = $derived(joinedState.status());
  const allCommunities = $derived(getAllCommunities());
  const communitiesLoaded = $derived(getCommunitiesLoaded());
  const communities = $derived(allCommunities || []);

  // Community-scoped feed: with a community filter, items come from the
  // communities' activity models instead of the global curated timelines.
  const communityScoped = useCommunityScopedItems(() =>
    !communityFilter ? [] : communityFilter === 'joined' ? joinedCommunities : [communityFilter]
  );

  // NIP-50 learning search. A search is a relevance query: default to the
  // relays' ranking on the learning tab; leaving search mode leaves it too.
  const learningSearch = useLearningSearch({
    onActivate: () => {
      if (contentType === 'learning') sortBy = 'relevance';
    },
    onDeactivate: () => {
      if (sortBy === 'relevance') sortBy = 'newest';
    }
  });

  // Articles, learning and boards page through createTimelineFeed (the
  // applesauce v7 window loader). Calendar keeps its own date-range loaders —
  // it pages by event start, not created_at.
  const discoverFeeds = useDiscoverFeeds({
    feeds: /** @type {any[]} */ ([
      isEnabled('articles') && { type: 'articles', feed: createArticleFeed(DISPLAY_BATCH) },
      isEnabled('learning') && { type: 'learning', feed: createAmbFeed(DISPLAY_BATCH) },
      isEnabled('boards') && { type: 'boards', feed: createKanbanFeed(DISPLAY_BATCH) }
    ]).filter(Boolean),
    isShown: showsType,
    // A NIP-50 learning search is one ranked batch; the feed does not page it
    isPaged: (type) => !(type === 'learning' && learningSearch.isActive),
    onReveal: () => revealMore()
  });
  $effect(() => {
    if (discoverFeeds.settled) isLoading = false;
  });

  // Profiles of everything rendered or selectable, plus the curated sets so
  // the author autocomplete can offer them.
  const getAuthorProfiles = useProfileMap(() => {
    const _ = profileTrigger;
    const __ = getCuratedCacheVersion(); // React to async curated/WoT set resolution
    return [
      ...articles.map((a) => a.pubkey),
      ...ambResources.map((r) => r.pubkey),
      ...calendarEvents.map((e) => e.pubkey),
      ...kanbanBoards.map((b) => b.pubkey),
      ...communityScoped.items.map((i) => i.pubkey),
      ...authorFilter,
      ...(getCuratedAuthors('calendar') || []),
      ...(getCuratedAuthors('communikey') || []),
      ...(getCuratedAuthors('educational') || []),
      ...(getCuratedAuthors('longform') || []),
      ...(getCuratedAuthors('kanban') || [])
    ].filter(Boolean);
  });
  const authorProfiles = $derived(getAuthorProfiles());

  // Deletion watcher for the CONTENT authors only (not the curated/WoT sets —
  // those can be thousands of pubkeys with nothing rendered).
  useAuthorDeletions(() => {
    const _ = profileTrigger;
    return [
      ...articles.map((a) => a.pubkey),
      ...ambResources.map((r) => r.pubkey),
      ...calendarEvents.map((e) => e.pubkey),
      ...kanbanBoards.map((b) => b.pubkey),
      ...communityScoped.items.map((i) => i.pubkey)
    ].filter(Boolean);
  });

  const getCommunityProfiles = useProfileMap(() => allCommunities.map((c) => c.pubkey));
  const communityProfiles = $derived(getCommunityProfiles());
  const communityOptions = $derived(
    getCommunityFilterOptions(allCommunities, joinedCommunities, communityProfiles)
  );

  // ─── URL sync ─────────────────────────────────────────────────────────
  $effect(() => {
    const urlCommunity = $page.url.searchParams.get('community') || null;
    if (urlCommunity !== communityFilter) communityFilter = urlCommunity;

    const urlType = resolveDiscoverType($page.url.searchParams.get('type'), discoverTabs);
    if (urlType !== contentType) contentType = urlType;

    const urlAuthors = ($page.url.searchParams.get('author') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      urlAuthors.length !== authorFilter.length ||
      urlAuthors.some((pk, i) => pk !== authorFilter[i])
    ) {
      authorFilter = urlAuthors;
    }

    // Back-navigation: untracked so this only re-runs on $page changes, not
    // when activeSearchQuery is set programmatically (would race with goto())
    const urlSearch = $page.url.searchParams.get('search') || '';
    if (urlSearch !== untrack(() => activeSearchQuery)) {
      searchQuery = urlSearch;
      activeSearchQuery = urlSearch;
    }
  });

  // Write activeSearchQuery to the URL ($page untracked: no loop with the read above)
  $effect(() => {
    const search = activeSearchQuery;
    const urlSearch = untrack(() => $page.url.searchParams.get('search')) || '';
    if (search !== urlSearch) {
      updateQueryParams(
        untrack(() => $page.url.searchParams),
        { search: search || null }
      );
    }
  });

  // ─── Handlers ─────────────────────────────────────────────────────────
  /** @param {string} newType */
  function handleContentTypeChange(newType) {
    contentType = newType;
    relayFilter = null;
    displayLimit = DISPLAY_BATCH;
    searchQuery = '';
    activeSearchQuery = '';
    authorFilter = [];
    // One URL update for everything the tab switch resets. Two separate
    // updates raced: the URL-read effect ran on the first navigation while
    // the URL still carried the old `search`, and copied it back into state
    // (the search then stuck to the next tab, e.g. ?search=…&type=communities).
    // null for the default tab keeps the URL clean.
    updateQueryParams($page.url.searchParams, {
      type: newType === defaultContentType ? null : newType,
      author: null,
      search: null
    });
    if (newType !== 'learning') {
      learningFilters = createEmptyFilters();
      learningSearch.stop();
    }
  }

  /** @param {{ start: number, end: number }} range */
  function handleEventsDateRangeChange(range) {
    eventsDateRangeStart = range.start;
    eventsDateRangeEnd = range.end;
    hasMoreCalendarEvents = true;
    displayLimit = DISPLAY_BATCH;
    updateQueryParams($page.url.searchParams, {
      eventStart: String(range.start),
      eventEnd: String(range.end)
    });
    // Reload with the new range (full NIP-52 date filter parameters)
    dateRangeLoaderSub?.unsubscribe();
    dateRangeLoaderSub = createDateRangeCalendarLoader({
      rangeStart: range.start,
      rangeEnd: range.end
    })().subscribe({
      error: (/** @type {any} */ err) => console.error('🔍 Discover: Date range loader error:', err)
    });
  }

  /** @param {import('$lib/helpers/educational/searchQueryBuilder.js').SearchFilters} filters */
  function handleLearningFilterChange(filters) {
    learningFilters = filters;
    learningSearch.apply(filters);
  }

  function executeSearch() {
    activeSearchQuery = searchQuery.trim();
  }

  function clearSearch() {
    activeSearchQuery = '';
  }

  /** Add an author to the multi-author filter. @param {any} author */
  function selectAuthor(author) {
    if (authorFilter.includes(author.pubkey)) return;
    authorFilter = [...authorFilter, author.pubkey];
    activeSearchQuery = '';
    displayLimit = DISPLAY_BATCH;
    updateQueryParams($page.url.searchParams, { author: authorFilter.join(',') });
  }

  /** Remove one author, or all without a pubkey. @param {string} [pubkey] */
  function clearAuthorFilter(pubkey) {
    authorFilter = pubkey ? authorFilter.filter((pk) => pk !== pubkey) : [];
    displayLimit = DISPLAY_BATCH;
    updateQueryParams($page.url.searchParams, {
      author: authorFilter.length > 0 ? authorFilter.join(',') : null
    });
  }

  /** @param {string | null} newValue */
  function handleCommunityFilterChange(newValue) {
    communityFilter = newValue;
    displayLimit = DISPLAY_BATCH;
    updateQueryParams($page.url.searchParams, { community: newValue });
  }

  /** @param {any} event */
  function handleEventClick(event) {
    const originalEvent = event.originalEvent || event;
    const naddr = encodeEventToNaddr(originalEvent);
    if (naddr) goto(resolve(`/calendar/event/${naddr}`));
  }

  // Auto-search: debounce searchQuery → activeSearchQuery
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let searchDebounceTimer;
  $effect(() => {
    const text = searchQuery;
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      activeSearchQuery = text.trim();
    }, 300);
    return () => {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    };
  });

  // The learning search follows the active text (plus the selected SKOS filters)
  let previousActiveSearchQuery = '';
  $effect(() => {
    if (showsType('learning') && activeSearchQuery !== previousActiveSearchQuery) {
      previousActiveSearchQuery = activeSearchQuery;
      handleLearningFilterChange({
        searchText: activeSearchQuery,
        learningResourceType: learningFilters.learningResourceType || [],
        about: learningFilters.about || [],
        audience: learningFilters.audience || []
      });
    }
  });

  // ─── Calendar (events tab): date-range loaders, not the window loader ──
  // Pre-warm relay capabilities so pagination doesn't wait on NIP-52 detection
  if (isEnabled('events')) preWarmRelayCapabilitiesCache(getCalendarRelays());

  /** @type {import('rxjs').Subscription | undefined} */
  let dateRangeLoaderSub;
  // svelte-ignore state_referenced_locally
  const initialCalendarSub = !isEnabled('events')
    ? undefined
    : createDateRangeCalendarLoader({
        rangeStart: eventsDateRangeStart,
        rangeEnd: eventsDateRangeEnd
      })().subscribe({
        complete: () => {
          isLoading = false;
        },
        error: (/** @type {any} */ error) => {
          console.error('🔍 Discover: Calendar loader error:', error);
          isLoading = false;
        }
      });

  // Override relays and curated/WoT authors arriving late get the query the
  // initial load ran (the feeds handle this through sync(); the calendar is
  // one-shot).
  const initialCalendarRelays = new SvelteSet(getCalendarRelays());
  $effect(() => {
    if (!isEnabled('events')) return;
    const newCalendar = getCalendarRelays().filter((r) => !initialCalendarRelays.has(r));
    if (newCalendar.length === 0) return;
    newCalendar.forEach((r) => initialCalendarRelays.add(r));
    const sub = fetchEvents(
      newCalendar,
      applyCuratedFilter({ kinds: [31922, 31923], limit: 40 })
    ).subscribe();
    return () => sub.unsubscribe();
  });

  const baselineCalendarAuthors = new SvelteSet(getCuratedAuthors('calendar') || []);
  $effect(() => {
    const _ver = getCuratedCacheVersion();
    if (!isEnabled('events')) return;
    const current = getCuratedAuthors('calendar');
    if (!current) return;
    const newAuthors = current.filter((a) => !baselineCalendarAuthors.has(a));
    if (newAuthors.length === 0) return;
    newAuthors.forEach((a) => baselineCalendarAuthors.add(a));
    fetchEvents(getCalendarRelays(), {
      kinds: [31922, 31923],
      authors: newAuthors,
      limit: 20
    }).subscribe();
  });

  // Relay-side author filtering: selected authors get targeted queries so
  // their content is fetched even when it is outside the current windows.
  $effect(() => {
    if (authorFilter.length === 0) return;
    const authors = authorFilter;
    /** @type {import('rxjs').Subscription[]} */
    const subs = [];
    if (showsType('articles')) {
      subs.push(
        fetchEvents(getArticleRelays(), { kinds: [30023], authors, limit: 100 }).subscribe()
      );
    }
    if (showsType('learning')) {
      subs.push(
        fetchEvents(getEducationalRelays(), { kinds: [30142], authors, limit: 100 }).subscribe()
      );
    }
    if (showsType('events')) {
      subs.push(
        createDateRangeCalendarLoader(
          { rangeStart: eventsDateRangeStart, rangeEnd: eventsDateRangeEnd },
          { authors }
        )().subscribe()
      );
    }
    if (showsType('boards')) {
      subs.push(
        fetchEvents(getKanbanRelays(), { kinds: [30301], authors, limit: 100 }).subscribe()
      );
    }
    return () => subs.forEach((s) => s.unsubscribe());
  });

  // ─── Model subscriptions (store first: render whatever the store holds) ─
  const articleModelSub = !isEnabled('articles')
    ? undefined
    : eventStore
        .model(TimelineModel, { kinds: [30023] })
        .pipe(debounceTime(100))
        .subscribe((timeline) => {
          articles = timeline || [];
          isLoading = false;
          profileTrigger++;
        });

  // Boards with pub=private and never-named placeholder boards are not shown
  const kanbanModelSub = !isEnabled('boards')
    ? undefined
    : eventStore
        .model(TimelineModel, { kinds: [30301] })
        .pipe(debounceTime(100))
        .subscribe((timeline) => {
          kanbanBoards = withoutPlaceholderBoards(timeline || []).filter((/** @type {any} */ b) => {
            const pub = getTagValue(b, 'pub');
            return !pub || pub !== 'private';
          });
          isLoading = false;
          profileTrigger++;
        });

  const ambModelSub = !isEnabled('learning')
    ? undefined
    : /** @type {import('rxjs').Observable<any[]>} */ (eventStore.model(AMBResourceModel, []))
        .pipe(debounceTime(100))
        .subscribe((resources) => {
          ambResources = resources || [];
          isLoading = false;
          profileTrigger++;
        });

  // Calendar events follow the date range (re-subscribed when it changes)
  $effect(() => {
    if (!isEnabled('events')) return;
    const sub = /** @type {import('rxjs').Observable<any[]>} */ (
      eventStore.model(CalendarEventRangeModel, eventsDateRangeStart, eventsDateRangeEnd)
    )
      .pipe(debounceTime(100))
      .subscribe((events) => {
        calendarEvents = events || [];
        isLoading = false;
        profileTrigger++;
      });
    return () => sub.unsubscribe();
  });

  $effect(() => {
    return () => {
      initialCalendarSub?.unsubscribe();
      dateRangeLoaderSub?.unsubscribe();
      articleModelSub?.unsubscribe();
      kanbanModelSub?.unsubscribe();
      ambModelSub?.unsubscribe();
    };
  });

  // ─── Paging ───────────────────────────────────────────────────────────
  /** More to show: buffered items not yet displayed, or a source that can still page. */
  const hasMoreToShow = $derived.by(() => {
    if (contentType === 'people' || contentType === 'communities') return false;
    if (displayLimit < combinedContent.length) return true;
    return discoverFeeds.hasMore || (showsType('events') && hasMoreCalendarEvents);
  });
  // A network "load more" in flight: a feed waiting on a page it has not
  // buffered yet, or a calendar batch.
  const isLoadingMore = $derived(calendarLoadingMore || discoverFeeds.pending);

  /** Reveal the next display batch and re-arm the scroll sentinel. */
  function revealMore() {
    displayLimit += DISPLAY_BATCH;
    // The IntersectionObserver won't re-fire if the sentinel is still in the
    // viewport. Manually re-check after the DOM settles.
    requestAnimationFrame(() => {
      const sentinel = document.getElementById('load-more-sentinel');
      if (!sentinel) return;
      const rect = sentinel.getBoundingClientRect();
      if (rect.top < window.innerHeight + 200) loadMoreContent();
    });
  }

  /** Reveal buffered items first, then fetch from the network. */
  function loadMoreContent() {
    if (isLoadingMore || !hasMoreToShow) return;
    if (displayLimit < combinedContent.length) {
      displayLimit += DISPLAY_BATCH;
      // Pre-fetch from network if running low on buffer
      if (combinedContent.length - displayLimit < DISPLAY_BATCH) fetchMoreFromNetwork();
      return;
    }
    fetchMoreFromNetwork();
  }

  /** Widen each feed's window by one page and page the calendar forward. */
  function fetchMoreFromNetwork() {
    if (isLoadingMore) return;

    // Served from the prefetch buffer a loadMore() is synchronous and
    // `pending` never rises; otherwise the spinner shows until the relays
    // settle and the feeds hook reveals what arrived.
    discoverFeeds.loadMore();

    if (showsType('events') && hasMoreCalendarEvents) {
      calendarLoadingMore = true;
      let count = 0;
      const calendarCountBefore = calendarEvents.length;
      const done = () => {
        calendarLoadingMore = false;
        revealMore();
      };
      // Page forward from the latest start we have
      const lastStartTimestamp =
        calendarEvents.length > 0
          ? Math.max(...calendarEvents.map((e) => e.start || 0))
          : Math.floor(Date.now() / 1000);
      createPaginatedCalendarLoader(lastStartTimestamp, { limit: CALENDAR_BATCH_SIZE })()
        .pipe(takeUntil(timer(BATCH_TIMEOUT)))
        .subscribe({
          next: () => {
            count++;
          },
          complete: () => {
            if (count === 0) {
              hasMoreCalendarEvents = false;
              done();
            } else {
              // Wait for model debounce + Svelte reactivity to settle
              setTimeout(() => {
                if (calendarEvents.length <= calendarCountBefore) hasMoreCalendarEvents = false;
                done();
              }, 500);
            }
          },
          error: (/** @type {any} */ error) => {
            console.error('🔍 Discover: Calendar pagination error:', error);
            done();
          }
        });
    }

    // Nothing is waiting on the network: whatever the buffers held shows now.
    if (!isLoadingMore) revealMore();
  }

  // ─── Content pipeline (one $derived per step; see discover-pipeline.js) ─
  const learningSearchIds = $derived(learningSearch.isActive ? learningSearch.resultIds : null);

  const rawItems = $derived.by(() => {
    const _cacheVer = getCuratedCacheVersion(); // re-derive when the curated set resolves
    if (communityFilter) {
      return buildCommunityRawItems(communityScoped.items, contentType, {
        showsType,
        learningSearchIds
      });
    }
    return buildRawItems(
      { calendarEvents, ambResources, articles, kanbanBoards },
      { showsType, isAllowedAuthor, learningSearchIds }
    );
  });
  const relayFilteredItems = $derived(filterByRelay(rawItems, relayFilter));
  const authorFilteredItems = $derived(filterByAuthors(relayFilteredItems, authorFilter));
  const searchFilteredItems = $derived(
    filterBySearch(authorFilteredItems, activeSearchQuery, {
      profiles: authorProfiles,
      contentType,
      isLearningSearchActive: learningSearch.isActive
    })
  );
  const canSortByRelevance = $derived(contentType === 'learning' && learningSearch.isActive);
  const effectiveSortBy = $derived(resolveSortBy(contentType, sortBy, canSortByRelevance));
  const combinedContent = $derived(
    sortItems(searchFilteredItems, effectiveSortBy, learningSearch.rank)
  );
  const displayedContent = $derived(combinedContent.slice(0, displayLimit));
  // "My communities" with nothing to scope to: loading, really none, or unavailable
  const joinedFilter = $derived(
    joinedFilterState(communityFilter, joinedCommunities.length, joinedStatus)
  );
  const joinedEmptyMessage = $derived(
    joinedFilter === 'empty'
      ? m.discover_joined_filter_empty()
      : joinedFilter === 'unavailable'
        ? m.discover_joined_filter_unavailable()
        : ''
  );
  const joinedEmptyHint = $derived(
    joinedFilter === 'empty'
      ? m.discover_joined_filter_empty_hint()
      : joinedFilter === 'unavailable'
        ? m.discover_joined_filter_unavailable_hint()
        : ''
  );
  const hasAnySource = $derived(
    articles.length > 0 ||
      ambResources.length > 0 ||
      calendarEvents.length > 0 ||
      kanbanBoards.length > 0
  );

  // Communities tab: named profiles only, searched by name and description
  const filteredCommunities = $derived.by(() => {
    let filtered = communities.filter((community) =>
      hasDisplayableCommunityProfile(communityProfiles.get(community.pubkey))
    );
    if (activeSearchQuery.trim()) {
      const query = activeSearchQuery.toLowerCase();
      filtered = filtered.filter((community) => {
        const profile = communityProfiles.get(community.pubkey);
        const name = profile?.name?.toLowerCase() || '';
        const about = profile?.about?.toLowerCase() || '';
        return name.includes(query) || about.includes(query);
      });
    }
    return filtered;
  });
</script>

<svelte:head>
  <title>{m.discover_content_meta_title({ appName: runtimeConfig.appName })}</title>
  <meta name="description" content={m.discover_content_meta_description()} />
</svelte:head>

<div>
  <DiscoverHero {activeUser} heroImage={runtimeConfig.ui?.discoverHeroImage} />

  <DiscoverTabs tabs={discoverTabs} active={contentType} onchange={handleContentTypeChange} />

  <!-- Filters (shown for all content types) -->
  <div class="container mx-auto space-y-4 px-4 py-6">
    <DiscoverSearchBar
      bind:value={searchQuery}
      {contentType}
      {authorProfiles}
      {authorFilter}
      isSearching={contentType === 'learning' &&
        learningSearch.isActive &&
        learningSearch.results.length === 0}
      onsearch={executeSearch}
      onclear={clearSearch}
      onauthorselect={selectAuthor}
      onauthorremove={(pubkey) => clearAuthorFilter(pubkey)}
      onauthorsclear={() => clearAuthorFilter()}
    />

    <DiscoverFilterBar
      {contentType}
      bind:sortBy
      {canSortByRelevance}
      {activeUser}
      {communityFilter}
      {communityOptions}
      oncommunitychange={handleCommunityFilterChange}
      relayCategory={tabRelayCategory}
      {availableRelays}
      {relayFilter}
      onrelaychange={(v) => {
        relayFilter = v;
        displayLimit = DISPLAY_BATCH;
      }}
      eventsRange={{ start: eventsDateRangeStart, end: eventsDateRangeEnd }}
      onrangechange={handleEventsDateRangeChange}
      onlearningfilterchange={handleLearningFilterChange}
      learningIsSearching={learningSearch.isActive && learningSearch.results.length === 0}
      searchText={activeSearchQuery}
      resultCount={displayedContent.length}
      hasMore={hasMoreToShow}
    />
  </div>

  <!-- Content -->
  <div class="container mx-auto px-4 py-8">
    {#if contentType === 'boards'}
      <!-- Boards are authored in the external Kanban editor; shown above the
           loading/empty/results states so it is reachable in all of them -->
      <div class="mb-6 flex justify-center">
        <CreateBoardLink />
      </div>
    {/if}
    {#if contentType === 'communities'}
      <CommunitiesTab
        communities={filteredCommunities}
        loaded={communitiesLoaded}
        {activeUser}
        query={activeSearchQuery}
        oncreate={() => modalStore.openModal('createCommunity')}
      />
    {:else if contentType === 'people'}
      <!-- People: profile search, follows first, then by NIP-85 trust rank -->
      <PeopleResults query={activeSearchQuery} />
    {:else}
      <DiscoverFeedGrid
        items={displayedContent}
        {authorProfiles}
        isLoading={isLoading || joinedFilter === 'loading'}
        isSearching={learningSearch.isSearching}
        {hasAnySource}
        emptyMessage={joinedEmptyMessage}
        emptyHint={joinedEmptyHint}
        hasMore={hasMoreToShow}
        {isLoadingMore}
        failing={discoverFeeds.failing}
        onEventClick={handleEventClick}
        onloadmore={loadMoreContent}
      />
    {/if}
  </div>
</div>
