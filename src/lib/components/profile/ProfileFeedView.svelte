<!--
  ProfileFeedView — Unified chronological feed for a user's profile.
  Loads multiple content types from their respective relays, merges via
  a single TimelineModel subscription, and renders with filter chips.
-->

<script>
  /* eslint-disable svelte/prefer-svelte-reactivity -- Map/Set inside $derived.by() must be plain to avoid infinite loops */
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { TimelineModel } from 'applesauce-core/models';
  import { getNip10References, getSharedEventPointer } from 'applesauce-common/helpers';
  import { getTagValue } from 'applesauce-core/helpers';
  import { addressLoader, eventLoader } from '$lib/loaders/base.js';
  import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { startProfileFeedLoaders } from '$lib/loaders/profile-feed-loaders.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getProfileLookupRelays, getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { pinEvent, unpinEvent } from '$lib/services/pin-list-service.js';
  import { showToast } from '$lib/helpers/toast';
  import { getCalendarEventMetadata } from '$lib/helpers/eventUtils.js';
  import { formatAMBResource } from '$lib/helpers/educational/index.js';
  import { filterSocialBookmarks, groupByUrl, groupByEventRef } from '$lib/helpers/urlGrouping.js';
  import {
    FEED_CATEGORIES,
    ALL_FEED_KINDS,
    kindToFeedCategory,
    filterFeedItems,
    isEntryPinned
  } from '$lib/helpers/profile-feed.js';
  import { mergeRepostsIntoFeed } from '$lib/helpers/repost-feed.js';
  import { resolveRepostReferences } from '$lib/helpers/repost-resolution.js';
  import NoteCard from '$lib/components/notes/NoteCard.svelte';
  import CalendarEventCard from '$lib/components/calendar/CalendarEventCard.svelte';
  import AMBResourceCard from '$lib/components/educational/AMBResourceCard.svelte';
  import ArticleCard from '$lib/components/article/ArticleCard.svelte';
  import UrlCard from '$lib/components/bookmarks/UrlCard.svelte';
  import EventHighlightCard from '$lib/components/bookmarks/EventHighlightCard.svelte';
  import PollCard from '$lib/components/polls/PollCard.svelte';
  import SharedByLine from '$lib/components/shared/SharedByLine.svelte';
  import {
    ChatIcon,
    CalendarIcon,
    GraduationCapIcon,
    BookIcon,
    BookmarkIcon,
    PollIcon,
    PinIcon
  } from '$lib/components/icons';
  import { feedStateCache } from '$lib/stores/feed-state-cache.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   pubkeys: string[],
   *   activeUser?: any,
   *   userPubkey?: string | null,
   *   externalLoaders?: boolean,
   *   pinnedPointers?: import('$lib/helpers/profile-feed.js').PinPointer[],
   *   canPin?: boolean,
   *   showFilters?: boolean
   * }}
   */
  let {
    pubkeys,
    activeUser = null,
    userPubkey = null,
    externalLoaders = false,
    pinnedPointers = [],
    canPin = false,
    showFilters = true
  } = $props();

  /** Filter chip config */
  const FILTER_CHIPS = [
    { id: 'notes', label: () => m.profile_tab_notes(), icon: ChatIcon },
    { id: 'calendar', label: () => m.profile_tab_calendar(), icon: CalendarIcon },
    { id: 'resources', label: () => m.profile_tab_resources(), icon: GraduationCapIcon },
    { id: 'articles', label: () => m.profile_tab_articles(), icon: BookIcon },
    { id: 'bookmarks', label: () => m.profile_tab_bookmarks(), icon: BookmarkIcon },
    { id: 'polls', label: () => m.profile_tab_polls(), icon: PollIcon }
  ];

  const feedCacheKey = $derived('profile-feed-' + (userPubkey || 'default'));
  const savedFeedState = $derived(feedStateCache.get(feedCacheKey));

  const DISPLAY_BATCH = 10;
  const BOOKMARK_KINDS = new Set([39701, 9802, 1111]);

  let items = $state.raw(/** @type {any[]} */ ([]));
  let repostItems = $state.raw(/** @type {any[]} */ ([]));
  let resolvedTargets = $state.raw(/** @type {any[]} */ ([]));
  let isLoading = $state(true);
  let displayLimit = $state(untrack(() => savedFeedState)?.displayLimit ?? DISPLAY_BATCH);
  // Without the chip UI there is nothing to toggle — ignore any cached filter
  // subset and always show every category.
  let activeFilters = new SvelteSet(
    untrack(() => (showFilters ? savedFeedState?.activeFilters : null)) ??
      FEED_CATEGORIES.map((c) => c.id)
  );

  // Derive pubkeys from all sources for profile loading (items + reposters + resolved targets)
  const itemPubkeys = $derived.by(() => {
    /** @type {string[]} */
    const all = [];
    for (const e of items) all.push(e.pubkey);
    for (const r of repostItems) all.push(r.pubkey);
    for (const t of resolvedTargets) all.push(t.pubkey);
    return [...new Set(all)];
  });

  const getAuthorProfiles = useProfileMap(() => itemPubkeys);
  let authorProfiles = $derived(getAuthorProfiles());

  // Separate non-bookmark items from bookmark items, apply filters, merge reposts
  const feedItems = $derived.by(() => {
    const filtered = filterFeedItems(items, activeFilters);

    // Split bookmarks from regular items
    const regular = [];
    const bookmarkEvents = [];
    for (const event of filtered) {
      if (BOOKMARK_KINDS.has(event.kind)) {
        bookmarkEvents.push(event);
      } else {
        regular.push(event);
      }
    }

    // Filter notes: only root notes (no replies)
    const regularFiltered = regular.filter((event) => {
      if (event.kind !== 1) return true;
      const refs = getNip10References(event);
      return !refs?.reply?.e && !refs?.root?.e;
    });

    // Group bookmarks
    /** @type {Array<{type: string, data: any, ts: number, repost?: {sharers: string[], latestRepostTs: number}}>} */
    const feedEntries = regularFiltered.map((e) => ({
      type: kindToFeedCategory(e.kind) || 'unknown',
      data: e,
      ts: e.created_at
    }));

    if (bookmarkEvents.length > 0) {
      const urlGroups = groupByUrl(filterSocialBookmarks(bookmarkEvents));
      const eventRefGroups = groupByEventRef(bookmarkEvents);
      for (const g of urlGroups) {
        feedEntries.push({ type: 'bookmark-url', data: g, ts: g.latestActivity });
      }
      for (const g of eventRefGroups) {
        feedEntries.push({ type: 'bookmark-ref', data: g, ts: g.latestActivity });
      }
    }

    // Merge reposts into feed entries (grouping + dedup against direct posts)
    if (repostItems.length > 0) {
      // Build lookup from direct items + resolved repost targets
      const resolvedLookup = new Map();
      for (const event of items) {
        resolvedLookup.set(event.id, event);
        const dTag = getTagValue(event, 'd');
        if (dTag) resolvedLookup.set(`${event.kind}:${event.pubkey}:${dTag}`, event);
      }
      for (const event of resolvedTargets) {
        resolvedLookup.set(event.id, event);
        const dTag = getTagValue(event, 'd');
        if (dTag) resolvedLookup.set(`${event.kind}:${event.pubkey}:${dTag}`, event);
      }

      const merged = mergeRepostsIntoFeed(feedEntries, repostItems, resolvedLookup);

      // Filter repost entries by active categories
      const filteredMerged = merged.filter((entry) => {
        return activeFilters.has(entry.type);
      });

      filteredMerged.sort((a, b) => b.ts - a.ts);
      return filteredMerged;
    }

    // Sort chronologically (newest first)
    feedEntries.sort((a, b) => b.ts - a.ts);
    return feedEntries;
  });

  // Pinned entries render first under their own divider; the rest paginates.
  const pinnedEntries = $derived(
    pinnedPointers.length ? feedItems.filter((e) => isEntryPinned(e, pinnedPointers)) : []
  );
  const unpinnedItems = $derived(
    pinnedPointers.length ? feedItems.filter((e) => !isEntryPinned(e, pinnedPointers)) : feedItems
  );
  const displayedItems = $derived(unpinnedItems.slice(0, displayLimit));
  const hasMore = $derived(unpinnedItems.length > displayLimit);

  // Fetch pinned events that the feed loaders didn't bring in (older than the
  // window, or on other relays). Capped, fail-silent.
  const requestedPins = new Set();
  $effect(() => {
    if (!pinnedPointers.length) return;

    const loaded = new Set();
    for (const event of items) {
      loaded.add(event.id);
      const dTag = getTagValue(event, 'd');
      if (dTag) loaded.add(`${event.kind}:${event.pubkey}:${dTag}`);
    }

    /** @type {import('rxjs').Subscription[]} */
    const subs = [];
    const relays = untrack(() => getAllLookupRelays());
    for (const pointer of pinnedPointers.slice(0, 10)) {
      if (loaded.has(pointer.value) || requestedPins.has(pointer.value)) continue;
      requestedPins.add(pointer.value);
      try {
        if (pointer.type === 'e') {
          subs.push(eventLoader({ id: pointer.value, relays }).subscribe());
        } else {
          const [kind, pubkey, identifier] = pointer.value.split(':');
          subs.push(addressLoader({ kind: Number(kind), pubkey, identifier, relays }).subscribe());
        }
      } catch (err) {
        console.error('ProfileFeedView: pinned pointer load failed:', err);
      }
    }
    return () => subs.forEach((s) => s.unsubscribe());
  });

  /** @type {string | null} */
  let pinBusy = $state(null);

  /** @param {any} entry */
  async function togglePin(entry) {
    const event = entry?.data;
    if (!event?.id || pinBusy) return;
    pinBusy = event.id;
    try {
      if (isEntryPinned(entry, pinnedPointers)) {
        await unpinEvent(event);
      } else {
        await pinEvent(event);
      }
    } catch (err) {
      console.error('ProfileFeedView: pin toggle failed:', err);
      showToast(m.profile_pin_error(), 'error');
    } finally {
      pinBusy = null;
    }
  }

  // Loaders: outbox path (when userPubkey provided) or classic path, single model subscription.
  // Model subscription starts immediately (emits cached data from EventStore on remount).
  // Loaders are deferred by 100ms so quick back-nav + re-click has zero active subs to tear down.
  $effect(() => {
    // Reset data state without creating reactive dependencies.
    // displayLimit and activeFilters are initialized from cache at declaration
    // time, so they persist correctly across back-navigation without resetting here.
    untrack(() => {
      items = [];
      repostItems = [];
      resolvedTargets = [];
      isLoading = true;
    });

    if (!pubkeys?.length) {
      isLoading = false;
      return;
    }

    /** @type {import('rxjs').Subscription[]} */
    const subs = [];

    // Model subscription starts immediately — emits cached data on remount
    const modelSub = eventStore
      .model(TimelineModel, { kinds: ALL_FEED_KINDS, authors: pubkeys })
      .subscribe({
        next: (loaded) => {
          items = loaded || [];
          isLoading = false;
        },
        error: (err) => {
          console.error('ProfileFeedView: Model error:', err);
          isLoading = false;
        }
      });
    subs.push(modelSub);

    // Repost model subscription — kind 6/16 from followed users
    const repostModelSub = eventStore
      .model(TimelineModel, { kinds: [6, 16], authors: pubkeys })
      .subscribe({
        next: (loaded) => {
          repostItems = loaded || [];
        },
        error: (err) => console.error('ProfileFeedView: Repost model error:', err)
      });
    subs.push(repostModelSub);

    // Defer loader creation so navigation isn't blocked if user clicks quickly after remount.
    // The model above already emits cached data instantly — loaders refresh from network shortly
    // after. Skipped entirely when the host page runs the loaders itself (externalLoaders).
    const loaderTimer = setTimeout(() => {
      if (!externalLoaders) {
        subs.push(...startProfileFeedLoaders({ pubkeys, userPubkey }));
      }
    }, 100);

    // Loading timeout fallback
    const timer = setTimeout(() => {
      isLoading = false;
    }, 3000);

    return () => {
      clearTimeout(loaderTimer);
      for (const sub of subs) sub.unsubscribe();
      clearTimeout(timer);
    };
  });

  // Resolve repost targets: extract embedded events, fetch by ID/address.
  // Deferred to match main loaders — avoids a burst of network requests on mount.
  const loadedRepostIds = new Set();
  const loadedRepostAddrs = new Set();

  $effect(() => {
    if (!repostItems.length) return;

    /** @type {import('rxjs').Subscription[]} */
    let subs = [];
    const repostTimer = setTimeout(() => {
      subs = resolveRepostReferences(repostItems, {
        eventStore,
        pool,
        addressLoader,
        relays: getAllLookupRelays(),
        loadedIds: loadedRepostIds,
        loadedAddresses: loadedRepostAddrs
      });
    }, 100);

    return () => {
      clearTimeout(repostTimer);
      subs.forEach((s) => s.unsubscribe());
    };
  });

  // Subscribe to resolved repost target events in EventStore
  $effect(() => {
    /** @type {string[]} */
    const ids = repostItems
      .map((/** @type {any} */ r) => getSharedEventPointer(r)?.id)
      .filter((/** @type {any} */ id) => !!id);
    if (!ids.length) {
      resolvedTargets = [];
      return;
    }
    const sub = eventStore.model(TimelineModel, { ids }).subscribe({
      next: (/** @type {any[]} */ events) => {
        resolvedTargets = events || [];
      }
    });
    return () => sub.unsubscribe();
  });

  function saveFeedState() {
    feedStateCache.set(feedCacheKey, {
      displayLimit,
      activeFilters: [...activeFilters]
    });
  }

  /** @param {string} id */
  function toggleFilter(id) {
    if (activeFilters.has(id)) {
      activeFilters.delete(id);
    } else {
      activeFilters.add(id);
    }
    displayLimit = DISPLAY_BATCH;
    saveFeedState();
  }

  function showMore() {
    displayLimit += DISPLAY_BATCH;
    saveFeedState();
  }

  // Sentinel-based infinite scroll
  /** @type {HTMLDivElement | undefined} */
  let sentinelEl = $state(undefined);

  $effect(() => {
    if (!sentinelEl || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) showMore();
      },
      { rootMargin: '200px', threshold: 0.1 }
    );

    observer.observe(sentinelEl);
    return () => observer.disconnect();
  });
</script>

<div class="py-4">
  {#if showFilters}
    <!-- Filter chips -->
    <div class="flex flex-wrap gap-2 pb-4">
      {#each FILTER_CHIPS as chip (chip.id)}
        {@const Icon = chip.icon}
        <button
          class="btn gap-1 btn-xs {activeFilters.has(chip.id) ? 'btn-primary' : 'btn-outline'}"
          onclick={() => toggleFilter(chip.id)}
        >
          <Icon class_="w-3 h-3" />
          {chip.label()}
        </button>
      {/each}
    </div>
  {/if}

  {#if isLoading}
    <div class="flex flex-col items-center justify-center py-16">
      <span class="loading loading-lg loading-spinner text-primary"></span>
      <p class="mt-4 text-base-content/60">{m.profile_content_loading()}</p>
    </div>
  {:else if feedItems.length === 0}
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <div class="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-base-200">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-12 w-12 text-base-content/40"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
          />
        </svg>
      </div>
      <h3 class="mb-2 text-lg font-semibold text-base-content">{m.profile_feed_empty_title()}</h3>
      <p class="max-w-md text-base-content/60">{m.profile_feed_empty_description()}</p>
    </div>
  {:else}
    {#snippet feedEntry(/** @type {any} */ entry, /** @type {boolean} */ pinned)}
      <div>
        {#if pinned || (canPin && entry.data?.id)}
          <div class="mb-1 flex items-center justify-between gap-2">
            {#if pinned}
              <span class="badge gap-1 badge-outline badge-sm text-warning" data-testid="pin-flag">
                <PinIcon class_="w-3 h-3" />
                {m.profile_pinned_divider()}
              </span>
            {:else}
              <span></span>
            {/if}
            {#if canPin && entry.data?.id}
              <button
                class="btn gap-1 btn-ghost btn-xs"
                data-testid="pin-toggle"
                disabled={pinBusy === entry.data.id}
                onclick={() => togglePin(entry)}
              >
                <PinIcon class_="w-3 h-3" />
                {pinned ? m.profile_unpin_action() : m.profile_pin_action()}
              </button>
            {/if}
          </div>
        {/if}
        {#if entry.repost}
          <SharedByLine sharers={entry.repost.sharers} {authorProfiles} />
        {/if}
        {#if entry.type === 'notes'}
          <NoteCard
            note={entry.data}
            authorProfile={authorProfiles.get(entry.data.pubkey) || null}
            {activeUser}
            extraRelays={getProfileLookupRelays()}
          />
        {:else if entry.type === 'calendar'}
          {@const event = getCalendarEventMetadata(entry.data)}
          {#if event}
            <CalendarEventCard
              {event}
              compact={false}
              authorProfile={authorProfiles.get(entry.data.pubkey) || null}
            />
          {/if}
        {:else if entry.type === 'resources'}
          {@const resource = formatAMBResource(entry.data)}
          {#if resource}
            <AMBResourceCard
              {resource}
              authorProfile={authorProfiles.get(entry.data.pubkey) || null}
              compact={false}
            />
          {/if}
        {:else if entry.type === 'articles'}
          <ArticleCard
            article={entry.data}
            authorProfile={authorProfiles.get(entry.data.pubkey) || null}
            compact={false}
          />
        {:else if entry.type === 'bookmark-url'}
          <UrlCard group={entry.data} {authorProfiles} />
        {:else if entry.type === 'bookmark-ref'}
          <EventHighlightCard group={entry.data} {authorProfiles} />
        {:else if entry.type === 'polls'}
          <PollCard event={entry.data} truncate={true} />
        {/if}
      </div>
    {/snippet}

    <div class="space-y-4">
      {#if pinnedEntries.length > 0}
        <div
          class="flex items-center gap-2 text-xs font-bold tracking-wider text-warning uppercase"
        >
          <PinIcon class_="w-3.5 h-3.5" />
          {m.profile_pinned_divider()}
          <span class="h-px flex-1 bg-base-300"></span>
        </div>
        {#each pinnedEntries as entry (entry.type + '-pin-' + (entry.data.id || entry.data.url || entry.data.aTagValue))}
          {@render feedEntry(entry, true)}
        {/each}
      {/if}
      {#each displayedItems as entry (entry.type + '-' + (entry.data.id || entry.data.url || entry.data.aTagValue))}
        {@render feedEntry(entry, false)}
      {/each}
    </div>

    {#if hasMore}
      <div bind:this={sentinelEl} class="flex justify-center py-6">
        <span class="loading loading-sm loading-spinner text-primary"></span>
      </div>
    {/if}
  {/if}
</div>
