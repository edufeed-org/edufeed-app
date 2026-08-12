<!--
  DashboardCommunityFeed — Shows upcoming events and recent activity
  from the user's joined communities using per-community loaders for
  complete content (direct + reposts + legacy 30222).
-->

<script>
  /* eslint-disable svelte/prefer-svelte-reactivity -- Map/Set used intentionally for non-reactive internal tracking */
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { getNip10References } from 'applesauce-common/helpers';
  import { TimelineModel } from 'applesauce-core/models';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { contactsStore } from '$lib/stores/contacts.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { ALL_FEED_KINDS } from '$lib/helpers/profile-feed.js';
  import { startProfileFeedLoaders } from '$lib/loaders/profile-feed-loaders.js';
  import { addressLoader } from '$lib/loaders/base.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { getFeedCardData } from '$lib/helpers/feedCardData.js';
  import { filterUpcomingEvents, mergeCommunityActivity } from '$lib/helpers/dashboardFilters.js';
  import { filterEventsByAccess } from '$lib/helpers/contentTypes.js';
  import { subscribeToCommunityAccess } from '$lib/groups/community-access-subscription.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
  import { useCommunityActivityLoader } from '$lib/loaders/community-activity.js';
  import { useSocialBookmarksCommunityLoader } from '$lib/loaders/social-bookmarks.js';
  import {
    CommunityActivityModel,
    CommunitySocialBookmarkModel
  } from '$lib/models/community-content.js';
  import { getContentEventRoute, resolveCommunityPubkey } from '$lib/helpers/contentNavigation.js';
  import FeedCard from '$lib/components/shared/FeedCard.svelte';
  import RichFeedEntry from '$lib/components/dashboard/RichFeedEntry.svelte';
  import { CalendarIcon, ChevronRightIcon, FilesIcon, SparkleIcon } from '$lib/components/icons';
  import EmptyState from '$lib/components/shared/EmptyState.svelte';
  import { getEventStartTimestamp } from '$lib/helpers/calendar';
  import { activeDateLocale } from '$lib/helpers/dates.js';
  import { feedStateCache } from '$lib/stores/feed-state-cache.js';
  import DashboardFeedSelector from '$lib/components/dashboard/DashboardFeedSelector.svelte';
  import FeedComposer from '$lib/components/dashboard/FeedComposer.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * previewCount > 0 renders a compact preview: no feed selector, at most
   * `previewCount` cards, and a "view all" button instead of incremental
   * loading. Used by the Home view.
   * includeFollows additionally merges content authored by the user's
   * follows (kind 3 contacts) into the list — the "combined" feed source.
   * @type {{ previewCount?: number, includeFollows?: boolean }}
   */
  let { previewCount = 0, includeFollows = false } = $props();

  const getActiveUser = useActiveUser();

  /** @type {Map<string, any[]>} */
  let perCommunityItems = new Map();
  let allItems = $state.raw(/** @type {any[]} */ ([]));
  let followItems = $state.raw(/** @type {any[]} */ ([]));
  let isLoading = $state(true);
  let displayCount = $state(15);

  const getJoinedCommunities = useJoinedCommunitiesList();
  let joinedCommunities = $derived(getJoinedCommunities());

  // Community profiles for name badges
  const getCommunityProfiles = useProfileMap(() => joinedCommunities);
  let communityProfiles = $derived(getCommunityProfiles());

  // Bookmark/comment kinds need the grouped rendering of ProfileFeedView —
  // as standalone feed cards they are noise, so keep them out of the merge.
  const FOLLOWS_EXCLUDED_KINDS = new Set([39701, 9802, 1111]);

  // Community items merged with follows-authored items (combined mode).
  // Deduped by id; kind-1 replies are excluded — only root notes belong here.
  let feedItems = $derived.by(() => {
    if (!includeFollows || followItems.length === 0) return allItems;
    const seen = new Set();
    const merged = [];
    for (const event of allItems) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      merged.push(event);
    }
    for (const event of followItems) {
      if (seen.has(event.id)) continue;
      if (FOLLOWS_EXCLUDED_KINDS.has(event.kind)) continue;
      if (event.kind === 1) {
        const refs = getNip10References(event);
        if (refs?.reply?.e || refs?.root?.e) continue;
      }
      seen.add(event.id);
      merged.push(event);
    }
    return merged.toSorted((a, b) => b.created_at - a.created_at);
  });

  // Event author profiles
  const getProfiles = useProfileMap(() => feedItems.map((e) => e.pubkey));
  let profiles = $derived(getProfiles());

  let upcomingEvents = $derived.by(() => {
    const nowTs = Math.floor(Date.now() / 1000);
    return filterUpcomingEvents(feedItems, nowTs);
  });

  let visibleItems = $derived(feedItems.slice(0, previewCount > 0 ? previewCount : displayCount));
  let hasMore = $derived(previewCount === 0 && displayCount < feedItems.length);

  // Per-community cleanup functions
  /** @type {Map<string, () => void>} */
  let cleanupMap = new Map();

  // Per-community ACL state: community event + ready access object for filtering
  /** @type {Map<string, { communityEvent: any, access: { isLoading: boolean, getAllowedAuthors: (name: string) => string[] | null } | null, aclLoading: boolean }>} */
  let perCommunityAcl = new Map();

  $effect(() => {
    const communities = joinedCommunities;

    // Clean up previous subscriptions
    for (const cleanup of cleanupMap.values()) cleanup();
    cleanupMap.clear();
    perCommunityItems = new Map();
    perCommunityAcl = new Map();
    displayCount = feedStateCache.get('dashboard-community-feed')?.displayCount ?? 15;

    if (communities.length === 0) {
      allItems = [];
      isLoading = false;
      return;
    }

    for (const pubkey of communities) {
      // Ensure community kind 10222 event is in EventStore for relay discovery
      const addrSub = addressLoader({
        kind: 10222,
        pubkey,
        relays: getCommunikeyRelays()
      }).subscribe();

      // Load all content sources (direct + reposts + legacy 30222)
      const { cleanup: activityCleanup } = useCommunityActivityLoader(pubkey);
      const { cleanup: bookmarkCleanup } = useSocialBookmarksCommunityLoader(pubkey);

      // Merge activity + bookmark models per community (same pattern as HomeView)
      /** @type {any[]} */
      let activityItems = [];
      /** @type {any[]} */
      let bookmarkItems = [];

      function mergeAndUpdate() {
        const seen = new Set();
        let merged = [...activityItems, ...bookmarkItems].filter((e) => {
          if (seen.has(e.id)) return false;
          seen.add(e.id);
          return true;
        });

        // Apply ACL filtering if community event and access data are available
        const acl = perCommunityAcl.get(pubkey);
        if (acl?.communityEvent && acl.access) {
          merged = filterEventsByAccess(merged, acl.communityEvent, acl.access);
        }

        perCommunityItems.set(pubkey, merged);
        allItems = mergeCommunityActivity(perCommunityItems);
        isLoading = false;
      }

      // Subscribe to community event for ACL setup
      /** @type {(() => void) | undefined} */
      let aclCleanup;
      const communitySub = eventStore.replaceable(10222, pubkey).subscribe((communityEvent) => {
        // Clean up previous ACL subscriptions when community event updates
        if (aclCleanup) aclCleanup();

        if (!communityEvent) {
          perCommunityAcl.set(pubkey, {
            communityEvent: null,
            access: null,
            aclLoading: false
          });
          mergeAndUpdate();
          return;
        }

        perCommunityAcl.set(pubkey, {
          communityEvent,
          access: null,
          aclLoading: true
        });

        const { cleanup: accessCleanup, hasRestrictedSections } = subscribeToCommunityAccess(
          communityEvent,
          getCommunikeyRelays(),
          (access) => {
            const acl = perCommunityAcl.get(pubkey);
            if (acl) {
              acl.access = access;
              acl.aclLoading = access.isLoading;
            }
            mergeAndUpdate();
          }
        );

        if (!hasRestrictedSections) {
          const acl = perCommunityAcl.get(pubkey);
          if (acl) acl.aclLoading = false;
          mergeAndUpdate();
        }

        aclCleanup = accessCleanup;
      });

      const activitySub = eventStore.model(CommunityActivityModel, pubkey).subscribe({
        next: (loaded) => {
          activityItems = loaded || [];
          mergeAndUpdate();
        },
        error: (err) => {
          console.error(`DashboardCommunityFeed: Activity error for ${pubkey}:`, err);
        }
      });

      const bookmarkSub = eventStore.model(CommunitySocialBookmarkModel, pubkey).subscribe({
        next: (loaded) => {
          bookmarkItems = loaded || [];
          mergeAndUpdate();
        },
        error: (err) => {
          console.error(`DashboardCommunityFeed: Bookmark error for ${pubkey}:`, err);
        }
      });

      cleanupMap.set(pubkey, () => {
        addrSub.unsubscribe();
        communitySub.unsubscribe();
        if (aclCleanup) aclCleanup();
        activitySub.unsubscribe();
        bookmarkSub.unsubscribe();
        activityCleanup();
        bookmarkCleanup();
      });
    }

    return () => {
      for (const cleanup of cleanupMap.values()) cleanup();
      cleanupMap.clear();
    };
  });

  // Combined mode: subscribe to content authored by the user's follows.
  // Same model + loaders as the follows feed (ProfileFeedView), rendered
  // here uniformly as FeedCards.
  $effect(() => {
    if (!includeFollows) {
      followItems = [];
      return;
    }
    const contacts = contactsStore.contacts;
    if (!contacts.length) {
      followItems = [];
      return;
    }

    /** @type {import('rxjs').Subscription[]} */
    const subs = [];
    subs.push(
      eventStore.model(TimelineModel, { kinds: ALL_FEED_KINDS, authors: contacts }).subscribe({
        next: (loaded) => {
          followItems = loaded || [];
        },
        error: (err) => console.error('DashboardCommunityFeed: follows model error:', err)
      })
    );

    // Defer network loaders slightly (same pattern as ProfileFeedView) —
    // the model already emits cached data instantly.
    const loaderTimer = setTimeout(() => {
      subs.push(
        ...startProfileFeedLoaders({ pubkeys: contacts, userPubkey: getActiveUser()?.pubkey })
      );
    }, 100);

    return () => {
      clearTimeout(loaderTimer);
      subs.forEach((s) => s.unsubscribe());
    };
  });

  /** @param {any} event */
  function navigateToEvent(event) {
    const communityPubkey = resolveCommunityPubkey(event, perCommunityItems);
    const route = getContentEventRoute(event, { communityPubkey });
    if (route) goto(resolve(/** @type {any} */ (route)));
  }

  /**
   * Get community info (name, avatar, pubkey) from an event's h-tag
   * @param {any} event
   * @returns {{ name?: string, avatar?: string, pubkey?: string }}
   */
  function getCommunityInfo(event) {
    const hTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'h')?.[1];
    if (!hTag) return {};
    const profile = communityProfiles.get(hTag);
    return {
      name: profile ? getDisplayName(profile) : undefined,
      avatar: profile ? getProfilePicture(profile) : undefined,
      pubkey: hTag
    };
  }

  function loadMore() {
    displayCount += 15;
    feedStateCache.set('dashboard-community-feed', { displayCount });
  }

  /**
   * Date-square + time parts for the upcoming-events rail.
   * @param {number} startTs
   * @param {number} kind
   */
  function getUpcomingDateParts(startTs, kind) {
    const date = new Date(startTs * 1000);
    const locale = activeDateLocale();
    return {
      day: date.toLocaleDateString(locale, { day: 'numeric' }),
      month: date.toLocaleDateString(locale, { month: 'short' }),
      // Kind 31922 is all-day (date-based) — no meaningful time to show
      time:
        kind === 31923
          ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
          : ''
    };
  }
</script>

{#if previewCount === 0}
  <div class="mb-4 flex items-center gap-3">
    <h1 class="text-2xl font-extrabold tracking-tight">{m.dashboard_nav_feed()}</h1>
    <div class="ml-auto">
      <DashboardFeedSelector />
    </div>
  </div>
  <FeedComposer />
{/if}

{#if isLoading}
  <div class="flex justify-center py-12">
    <span class="loading loading-lg loading-spinner text-primary"></span>
  </div>
{:else}
  <div class="flex flex-col gap-6 lg:flex-row lg:items-start">
    <!-- Activity Feed (main column) -->
    <div class="min-w-0 flex-1" data-testid="dashboard-community-activity">
      {#if visibleItems.length === 0}
        <EmptyState title={m.dashboard_activity_empty()}>
          {#snippet icon()}
            <FilesIcon class_="h-10 w-10" />
          {/snippet}
        </EmptyState>
      {:else}
        <div class="space-y-4">
          {#each visibleItems as event (event.id)}
            {@const cardData = getFeedCardData(event)}
            {@const profile = profiles.get(event.pubkey)}
            {@const community = getCommunityInfo(event)}
            {#snippet compactCard()}
              <FeedCard
                title={cardData.title}
                subtitle={cardData.subtitle}
                typeKey={cardData.typeKey}
                kind={event.kind}
                tags={cardData.tags}
                description={cardData.description}
                location={cardData.location}
                authorName={profile ? getDisplayName(profile) : undefined}
                authorAvatar={profile ? getProfilePicture(profile) : undefined}
                authorPubkey={event.pubkey}
                {event}
                communityName={community.name}
                communityAvatar={community.avatar}
                communityPubkey={community.pubkey}
                timestamp={event.created_at}
                onclick={() => navigateToEvent(event)}
              />
            {/snippet}
            {#if includeFollows}
              <!-- Combined feed renders rich per-kind cards (like the follows feed) -->
              <RichFeedEntry
                {event}
                authorProfile={profile ?? null}
                authorProfiles={profiles}
                activeUser={getActiveUser()}
                fallback={compactCard}
              />
            {:else}
              {@render compactCard()}
            {/if}
          {/each}
        </div>

        {#if hasMore}
          <div class="mt-4 flex justify-center">
            <button class="btn btn-ghost btn-sm" onclick={loadMore}>
              {m.discover_load_more()}
            </button>
          </div>
        {/if}

        {#if previewCount > 0 && feedItems.length > previewCount}
          <div class="mt-4 flex justify-center">
            <button
              class="btn btn-outline btn-sm"
              onclick={() => goto(resolve('/c/') + '?view=feed')}
            >
              {m.home_feed_preview_all()}
            </button>
          </div>
        {/if}
      {/if}
    </div>

    <!-- Upcoming Events Sidebar -->
    {#if upcomingEvents.length > 0}
      <div class="w-full shrink-0 lg:w-72" data-testid="dashboard-upcoming-events">
        <div
          class="rounded-2xl bg-gradient-to-b from-(--c-hero) to-(--c-hero-2) p-5 text-white shadow-[0_20px_40px_-24px_rgba(0,0,0,0.3)]"
        >
          <div class="mb-4 flex items-center gap-2">
            <CalendarIcon class_="h-4 w-4" />
            <h3 class="text-base font-extrabold tracking-tight">{m.dashboard_upcoming_title()}</h3>
            <a
              href={resolve('/calendar')}
              class="ml-auto flex items-center gap-0.5 text-xs font-medium text-white/85 hover:text-white"
            >
              {m.dashboard_upcoming_view_calendar()}
              <ChevronRightIcon class_="h-3 w-3" />
            </a>
          </div>
          <ol class="flex flex-col gap-3.5">
            {#each upcomingEvents as event (event.id)}
              {@const cardData = getFeedCardData(event)}
              {@const dateParts = getUpcomingDateParts(getEventStartTimestamp(event), event.kind)}
              {@const communityName = getCommunityInfo(event).name}
              <li>
                <button
                  class="-m-1.5 flex w-[calc(100%+0.75rem)] gap-3 rounded-lg p-1.5 text-left transition-colors hover:bg-white/10"
                  onclick={() => navigateToEvent(event)}
                >
                  <span class="w-12 shrink-0 rounded-lg bg-white/15 px-1 py-1.5 text-center">
                    <span class="block text-xl leading-none font-extrabold tracking-tight">
                      {dateParts.day}
                    </span>
                    <span
                      class="mt-1 block text-[10px] leading-none font-semibold uppercase opacity-80"
                    >
                      {dateParts.month}
                    </span>
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="line-clamp-2 text-[13px] leading-tight font-semibold">
                      {cardData.title}
                    </span>
                    {#if dateParts.time}
                      <span class="mt-1 block font-mono text-[11px] leading-none text-white/70">
                        {dateParts.time}
                      </span>
                    {/if}
                    {#if communityName}
                      <span class="mt-1 block text-[11px] leading-none text-white/70">
                        {communityName}
                      </span>
                    {/if}
                  </span>
                </button>
              </li>
            {/each}
          </ol>
        </div>

        <div class="mt-4 rounded-xl border border-base-300 bg-base-100 p-4">
          <div
            class="mb-2 flex items-center gap-1.5 text-[11px] font-bold tracking-widest text-accent uppercase"
          >
            <SparkleIcon class_="h-3 w-3" />
            {m.home_tip_label()}
          </div>
          <h4 class="mb-1.5 text-sm font-bold">{m.home_tip_title()}</h4>
          <p class="text-[13px] leading-relaxed text-base-content/70">{m.home_tip_body()}</p>
        </div>
      </div>
    {/if}
  </div>

  <!-- Playful nudge toward the create FAB. Viewport-fixed like the FAB itself
       so it always points at it; sits below the FAB's scrim (z-55). -->
  <div
    class="pointer-events-none fixed right-[5.5rem] bottom-9 z-30 hidden items-start gap-1.5 text-accent lg:flex"
    aria-hidden="true"
  >
    <span
      class="-rotate-2 rounded-md border border-base-300 bg-base-100 px-2.5 py-1 text-xl leading-none shadow-sm"
      style="font-family: var(--font-script)"
    >
      {m.home_fab_nudge()}
    </span>
    <svg
      class="fab-nudge-arrow h-10 w-10"
      viewBox="0 0 64 64"
      fill="none"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <!-- paper-colored halo keeps the arrow legible over any background -->
      <g stroke="var(--color-base-100)" stroke-width="8">
        <path d="M10 8c4 18 15 33 41 41" />
        <path d="M38 50l13-1-4-13" />
      </g>
      <g stroke="currentColor" stroke-width="3">
        <path d="M10 8c4 18 15 33 41 41" />
        <path d="M38 50l13-1-4-13" />
      </g>
    </svg>
  </div>
{/if}

<style>
  .fab-nudge-arrow {
    animation: fab-nudge 1.8s ease-in-out infinite;
  }
  @keyframes fab-nudge {
    0%,
    100% {
      transform: translate(0, 0);
    }
    50% {
      transform: translate(5px, 5px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .fab-nudge-arrow {
      animation: none;
    }
  }
</style>
