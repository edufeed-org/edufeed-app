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
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { addressLoader } from '$lib/loaders/base.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { getFeedCardData } from '$lib/helpers/feedCardData.js';
  import { filterUpcomingEvents, mergeCommunityActivity } from '$lib/helpers/dashboardFilters.js';
  import { filterEventsByAccess } from '$lib/helpers/contentTypes.js';
  import {
    subscribeToProfileListMembers,
    buildProfileAccess
  } from '$lib/helpers/profile-list-members.js';
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
  import { ChevronRightIcon, FilesIcon } from '$lib/components/icons';
  import { generateKindColorRGB } from '$lib/helpers/nostrUtils';
  import { getEventStartTimestamp } from '$lib/helpers/calendar';
  import * as m from '$lib/paraglide/messages';

  /** @type {Map<string, any[]>} */
  let perCommunityItems = new Map();
  let allItems = $state.raw(/** @type {any[]} */ ([]));
  let isLoading = $state(true);
  let displayCount = $state(15);

  const getJoinedCommunities = useJoinedCommunitiesList();
  let joinedCommunities = $derived(getJoinedCommunities());

  // Community profiles for name badges
  const getCommunityProfiles = useProfileMap(() => joinedCommunities);
  let communityProfiles = $derived(getCommunityProfiles());

  // Event author profiles
  const getProfiles = useProfileMap(() => allItems.map((e) => e.pubkey));
  let profiles = $derived(getProfiles());

  let upcomingEvents = $derived.by(() => {
    const nowTs = Math.floor(Date.now() / 1000);
    return filterUpcomingEvents(allItems, nowTs);
  });

  let visibleItems = $derived(allItems.slice(0, displayCount));
  let hasMore = $derived(displayCount < allItems.length);

  // Per-community cleanup functions
  /** @type {Map<string, () => void>} */
  let cleanupMap = new Map();

  // Per-community ACL state: community event + member map for filtering
  /** @type {Map<string, { communityEvent: any, memberMap: Map<string, Set<string>>, aclLoading: boolean }>} */
  let perCommunityAcl = new Map();

  $effect(() => {
    const communities = joinedCommunities;

    // Clean up previous subscriptions
    for (const cleanup of cleanupMap.values()) cleanup();
    cleanupMap.clear();
    perCommunityItems = new Map();
    perCommunityAcl = new Map();
    displayCount = 15;

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

        // Apply ACL filtering if community event and member data are available
        const acl = perCommunityAcl.get(pubkey);
        if (acl?.communityEvent) {
          const access = buildProfileAccess(acl.memberMap, acl.aclLoading);
          merged = filterEventsByAccess(merged, acl.communityEvent, access);
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
            memberMap: new Map(),
            aclLoading: false
          });
          mergeAndUpdate();
          return;
        }

        perCommunityAcl.set(pubkey, {
          communityEvent,
          memberMap: new Map(),
          aclLoading: true
        });

        const { cleanup: memberCleanup, hasRestrictedSections } = subscribeToProfileListMembers(
          communityEvent,
          getCommunikeyRelays(),
          (memberMap) => {
            const acl = perCommunityAcl.get(pubkey);
            if (acl) {
              acl.memberMap = memberMap;
              acl.aclLoading = false;
            }
            mergeAndUpdate();
          }
        );

        if (!hasRestrictedSections) {
          const acl = perCommunityAcl.get(pubkey);
          if (acl) acl.aclLoading = false;
          mergeAndUpdate();
        }

        aclCleanup = memberCleanup;
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
  }
</script>

{#if isLoading}
  <div class="flex justify-center py-12">
    <span class="loading loading-lg loading-spinner text-primary"></span>
  </div>
{:else}
  <div class="flex flex-col gap-6 lg:flex-row lg:items-start">
    <!-- Activity Feed (main column) -->
    <div class="min-w-0 flex-1" data-testid="dashboard-community-activity">
      {#if visibleItems.length === 0}
        <div
          class="flex flex-col items-center justify-center rounded-lg border border-base-300 bg-base-200/50 py-12 text-center"
        >
          <FilesIcon class_="mb-3 h-10 w-10 text-base-content/30" />
          <p class="text-base-content/60">{m.dashboard_activity_empty()}</p>
        </div>
      {:else}
        <div class="space-y-4">
          {#each visibleItems as event (event.id)}
            {@const cardData = getFeedCardData(event)}
            {@const profile = profiles.get(event.pubkey)}
            {@const community = getCommunityInfo(event)}
            <FeedCard
              title={cardData.title}
              subtitle={cardData.subtitle}
              typeKey={cardData.typeKey}
              kind={event.kind}
              tags={cardData.tags}
              description={cardData.description}
              authorName={profile ? getDisplayName(profile) : undefined}
              authorAvatar={profile ? getProfilePicture(profile) : undefined}
              authorPubkey={event.pubkey}
              communityName={community.name}
              communityAvatar={community.avatar}
              communityPubkey={community.pubkey}
              timestamp={event.created_at}
              onclick={() => navigateToEvent(event)}
            />
          {/each}
        </div>

        {#if hasMore}
          <div class="mt-4 flex justify-center">
            <button class="btn btn-ghost btn-sm" onclick={loadMore}>
              {m.discover_load_more()}
            </button>
          </div>
        {/if}
      {/if}
    </div>

    <!-- Upcoming Events Sidebar -->
    {#if upcomingEvents.length > 0}
      <div class="w-full shrink-0 lg:w-72" data-testid="dashboard-upcoming-events">
        <a
          href={resolve('/calendar')}
          class="mb-3 flex items-center gap-1 text-sm font-semibold hover:text-primary"
        >
          {m.dashboard_upcoming_title()}
          <ChevronRightIcon class_="h-4 w-4" />
        </a>
        <div class="flex flex-row gap-3 overflow-x-auto lg:flex-col lg:overflow-x-visible">
          {#each upcomingEvents as event (event.id)}
            {@const cardData = getFeedCardData(event)}
            {@const kindColor = generateKindColorRGB(event.kind)}
            {@const startTs = getEventStartTimestamp(event)}
            {@const communityName = getCommunityInfo(event).name}
            <button
              class="w-[200px] shrink-0 rounded-lg border border-l-4 border-base-300 bg-base-100 p-3 text-left shadow-sm transition-shadow hover:border-primary hover:shadow-md lg:w-full"
              style:border-left-color="rgb({kindColor.r},{kindColor.g},{kindColor.b})"
              onclick={() => navigateToEvent(event)}
            >
              <div class="text-xs font-medium text-primary">
                {new Date(startTs * 1000).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit'
                })}
              </div>
              <div class="mt-1 line-clamp-2 text-sm font-semibold">{cardData.title}</div>
              {#if communityName}
                <div class="mt-1 text-xs text-base-content/60">{communityName}</div>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}
