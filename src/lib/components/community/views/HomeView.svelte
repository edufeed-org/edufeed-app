<script>
  import CommunityProfileHero from './CommunityProfileHero.svelte';
  import PinnedSection from '../PinnedSection.svelte';
  import FeedCard from '$lib/components/shared/FeedCard.svelte';
  import { ChevronRightIcon } from '$lib/components/icons';
  import { getFeedCardData } from '$lib/helpers/feedCardData.js';
  import { getDisplayName, getProfilePicture, getSeenRelays } from 'applesauce-core/helpers';
  import { extractUrlFromEvent, extractEventRefFromHighlight } from '$lib/helpers/urlGrouping.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useCommunityActivityLoader } from '$lib/loaders/community-activity.js';
  import { useSocialBookmarksCommunityLoader } from '$lib/loaders/social-bookmarks.js';
  import {
    CommunityActivityModel,
    CommunitySocialBookmarkModel
  } from '$lib/models/community-content.js';
  import { goto } from '$app/navigation';
  import { encodeEventToNaddr, hexToNpub, generateKindColorRGB } from '$lib/helpers/nostrUtils.js';
  import { getEventStartTimestamp } from '$lib/helpers/calendar.js';
  import { nip19 } from 'nostr-tools';
  import * as m from '$lib/paraglide/messages';

  /** Navigate to the detail view for a feed event
   * @param {import('nostr-tools').Event} event */
  function navigateToEvent(event) {
    const isAddressable = event.kind >= 30000 && event.kind < 40000;
    const isCalendar = event.kind === 31922 || event.kind === 31923;
    const isBookmarkKind = event.kind === 39701 || event.kind === 9802 || event.kind === 1111;

    if (isBookmarkKind) {
      const rawUrl = extractUrlFromEvent(event);
      if (rawUrl && communityId) {
        const displayUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
        const npub = hexToNpub(communityId);
        const fragment = event.kind === 9802 ? `#highlight-${event.id}` : '';
        goto(`/c/${npub}/bookmarks/${encodeURIComponent(displayUrl)}${fragment}`);
        return;
      }
      // Event-ref highlight (a-tag, no r-tag) — navigate to article/wiki detail
      const pointer = extractEventRefFromHighlight(event);
      if (pointer && communityId) {
        const npub = hexToNpub(communityId);
        const routePrefix = pointer.kind === 30818 ? 'wiki' : 'article';
        const naddr = nip19.naddrEncode({
          kind: pointer.kind,
          pubkey: pointer.pubkey,
          identifier: pointer.identifier
        });
        goto(`/c/${npub}/${routePrefix}/${naddr}#highlight-${event.id}`);
      }
    } else if (isAddressable) {
      const naddr = encodeEventToNaddr(event);
      if (!naddr) return;
      goto(isCalendar ? `/calendar/event/${naddr}` : `/${naddr}`);
    } else if (event.kind === 11) {
      const relays = getSeenRelays(event);
      const nevent = nip19.neventEncode({
        id: event.id,
        relays: relays ? Array.from(relays).slice(0, 3) : []
      });
      goto(`/${nevent}`);
    }
  }

  let { communikeyEvent, profileEvent, communityId, onKindNavigation } = $props();

  const getActiveUser = useActiveUser();
  let activeUser = $derived(getActiveUser());
  let isAdmin = $derived(activeUser?.pubkey === communityId);

  // Activity feed state — use $state.raw for event arrays (Symbol-based relay provenance)
  /** @type {any[]} */
  let feedItems = $state.raw([]);
  let isLoadingFeed = $state(true);

  const getAuthorProfiles = useProfileMap(() => feedItems.map((i) => i.pubkey));
  let authorProfiles = $derived(getAuthorProfiles());

  // Plain let for internal refs — must NOT be $state to avoid infinite $effect loops
  /** @type {(() => void) | null} */
  let loaderCleanup = null;

  $effect(() => {
    // Only read communityId as the reactive dependency
    const pubkey = communityId;

    feedItems = [];
    isLoadingFeed = true;

    if (loaderCleanup) {
      loaderCleanup();
      loaderCleanup = null;
    }

    if (!pubkey) {
      isLoadingFeed = false;
      return;
    }

    const { cleanup: activityCleanup } = useCommunityActivityLoader(pubkey);
    const { cleanup: bookmarkCleanup } = useSocialBookmarksCommunityLoader(pubkey);

    /** @type {any[]} */
    let activityItems = [];
    /** @type {any[]} */
    let bookmarkItems = [];

    function mergeAndUpdate() {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local dedup, not reactive
      const seen = new Set();
      const merged = [...activityItems, ...bookmarkItems]
        .filter((e) => {
          if (seen.has(e.id)) return false;
          seen.add(e.id);
          return true;
        })
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, 15);
      feedItems = merged;
      isLoadingFeed = false;
    }

    const activitySub = eventStore.model(CommunityActivityModel, pubkey).subscribe({
      next: (loaded) => {
        activityItems = loaded || [];
        mergeAndUpdate();
      },
      error: (err) => {
        console.error('HomeView: Error loading activity feed:', err);
        isLoadingFeed = false;
      }
    });

    const bookmarkSub = eventStore.model(CommunitySocialBookmarkModel, pubkey).subscribe({
      next: (loaded) => {
        bookmarkItems = loaded || [];
        mergeAndUpdate();
      },
      error: (err) => {
        console.error('HomeView: Error loading bookmark feed:', err);
      }
    });

    loaderCleanup = () => {
      activitySub.unsubscribe();
      bookmarkSub.unsubscribe();
      activityCleanup();
      bookmarkCleanup();
    };

    return () => {
      if (loaderCleanup) {
        loaderCleanup();
        loaderCleanup = null;
      }
    };
  });

  let upcomingEvents = $derived.by(() => {
    const now = Math.floor(Date.now() / 1000);
    return feedItems
      .filter((e) => (e.kind === 31922 || e.kind === 31923) && getEventStartTimestamp(e) > now)
      .sort((a, b) => getEventStartTimestamp(a) - getEventStartTimestamp(b))
      .slice(0, 5);
  });
</script>

{#if profileEvent && communikeyEvent}
  <div class="bg-base-100">
    <!-- Community Profile Hero -->
    <CommunityProfileHero
      {communityId}
      {communikeyEvent}
      {profileEvent}
      onNavigateToAbout={() => onKindNavigation?.('settings')}
    />

    <!-- Main Content -->
    <div class="container mx-auto max-w-4xl px-4 py-8">
      <PinnedSection {communityId} {isAdmin} onNavigateToEvent={navigateToEvent} />

      <!-- Recent Activity + Upcoming Events (side by side on lg) -->
      <div class="flex flex-col gap-6 lg:flex-row lg:items-start">
        <!-- Recent Activity Feed -->
        <div class="min-w-0 flex-1">
          <h3 class="mb-3 text-sm font-semibold">
            {m.community_views_home_recent_activity_title()}
          </h3>

          {#if isLoadingFeed}
            <div class="flex flex-col items-center justify-center py-12">
              <span class="loading loading-lg loading-spinner text-primary"></span>
            </div>
          {:else if feedItems.length === 0}
            <div class="card bg-base-200 shadow-xl">
              <div class="card-body">
                <div class="py-8 text-center text-base-content/60">
                  <p class="text-sm">{m.community_views_home_recent_activity_empty()}</p>
                  <p class="mt-2 text-xs">{m.community_views_home_recent_activity_description()}</p>
                </div>
              </div>
            </div>
          {:else}
            <div class="space-y-4">
              {#each feedItems as event (event.id)}
                {@const profile = authorProfiles.get(event.pubkey)}
                {@const cardData = getFeedCardData(event)}
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
                  timestamp={event.created_at}
                  onclick={() => navigateToEvent(event)}
                />
              {/each}
            </div>
          {/if}
        </div>

        <!-- Upcoming Events Sidebar -->
        {#if upcomingEvents.length > 0}
          <div class="w-full shrink-0 lg:w-72">
            <button
              class="mb-3 flex items-center gap-1 text-sm font-semibold hover:text-primary"
              onclick={() => onKindNavigation?.('calendar')}
            >
              {m.community_upcoming_events_title()}
              <ChevronRightIcon class_="h-4 w-4" />
            </button>
            <div class="flex flex-row gap-3 overflow-x-auto lg:flex-col lg:overflow-x-visible">
              {#each upcomingEvents as event (event.id)}
                {@const cardData = getFeedCardData(event)}
                {@const kindColor = generateKindColorRGB(event.kind)}
                {@const startTs = getEventStartTimestamp(event)}
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
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{:else}
  <div class="flex h-full items-center justify-center">
    <div class="loading loading-lg loading-spinner text-primary"></div>
  </div>
{/if}
