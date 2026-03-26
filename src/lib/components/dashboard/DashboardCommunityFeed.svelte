<!--
  DashboardCommunityFeed — Shows upcoming events and recent activity
  from the user's joined communities in two sections.
-->

<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { nip19 } from 'nostr-tools';
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import { TimelineModel } from 'applesauce-core/models';
  import { getDisplayName, getProfilePicture, getSeenRelays } from 'applesauce-core/helpers';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { timedPool } from '$lib/loaders/base.js';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { getFeedCardData } from '$lib/helpers/feedCardData.js';
  import { filterUpcomingEvents, filterRecentActivity } from '$lib/helpers/dashboardFilters.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils';
  import FeedCard from '$lib/components/shared/FeedCard.svelte';
  import { CalendarIcon, FilesIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  const ALL_KINDS = [30142, 30301, 30023, 30818, 31922, 31923, 11];

  let items = $state.raw(/** @type {any[]} */ ([]));
  let isLoading = $state(true);

  const getJoinedCommunities = useJoinedCommunitiesList();
  let joinedCommunities = $derived(getJoinedCommunities());

  // Community profiles for name badges
  const getCommunityProfiles = useProfileMap(() => joinedCommunities);
  let communityProfiles = $derived(getCommunityProfiles());

  // Event author profiles
  const getProfiles = useProfileMap(() => items.map((e) => e.pubkey));
  let profiles = $derived(getProfiles());

  let upcomingEvents = $derived.by(() => {
    const nowTs = Math.floor(Date.now() / 1000);
    return filterUpcomingEvents(items, nowTs);
  });

  let recentItems = $derived.by(() => filterRecentActivity(items));

  $effect(() => {
    const communities = joinedCommunities;
    if (communities.length === 0) {
      items = [];
      isLoading = false;
      return;
    }

    const relays = getAllLookupRelays();
    const filter = { kinds: ALL_KINDS, '#h': communities, limit: 50 };

    const loader = createTimelineLoader(timedPool, relays, filter, { eventStore });
    const loaderSub = loader().subscribe({
      error: (err) => {
        console.error('DashboardCommunityFeed: Loader error:', err);
        isLoading = false;
      }
    });

    const modelSub = eventStore
      .model(TimelineModel, { kinds: ALL_KINDS, '#h': communities })
      .subscribe({
        next: (loaded) => {
          items = loaded || [];
          isLoading = false;
        }
      });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  /** @param {any} event */
  function navigateToEvent(event) {
    const isAddressable = event.kind >= 30000 && event.kind < 40000;
    const isCalendar = event.kind === 31922 || event.kind === 31923;

    if (isAddressable) {
      const naddr = encodeEventToNaddr(event);
      if (naddr) goto(resolve(isCalendar ? `/calendar/event/${naddr}` : `/${naddr}`));
    } else if (event.kind === 11) {
      const relays = getSeenRelays(event);
      const nevent = nip19.neventEncode({
        id: event.id,
        relays: relays ? Array.from(relays).slice(0, 3) : []
      });
      goto(resolve(`/${nevent}`));
    }
  }

  /** @param {any} event */
  function getCommunityName(event) {
    const hTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'h')?.[1];
    if (!hTag) return undefined;
    const profile = communityProfiles.get(hTag);
    return profile ? getDisplayName(profile) : undefined;
  }
</script>

<!-- Upcoming Events -->
<section data-testid="dashboard-upcoming-events">
  <div class="mb-4 flex items-center justify-between">
    <h2 class="text-lg font-bold">{m.dashboard_upcoming_title()}</h2>
    <a href={resolve('/calendar')} class="btn btn-ghost btn-sm">
      {m.dashboard_upcoming_view_calendar()} →
    </a>
  </div>

  {#if isLoading}
    <div class="flex justify-center py-8">
      <span class="loading loading-md loading-spinner text-primary"></span>
    </div>
  {:else if upcomingEvents.length === 0}
    <div
      class="flex flex-col items-center justify-center rounded-lg border border-base-300 bg-base-200/50 py-12 text-center"
    >
      <CalendarIcon class_="mb-3 h-10 w-10 text-base-content/30" />
      <p class="text-base-content/60">{m.dashboard_upcoming_empty()}</p>
    </div>
  {:else}
    <div class="grid gap-3 sm:grid-cols-2">
      {#each upcomingEvents as event (event.id)}
        {@const cardData = getFeedCardData(event)}
        {@const profile = profiles.get(event.pubkey)}
        {@const communityName = getCommunityName(event)}
        <FeedCard
          title={cardData.title}
          subtitle={cardData.subtitle}
          typeKey={cardData.typeKey}
          kind={event.kind}
          tags={cardData.tags}
          description={communityName || cardData.description}
          authorName={profile ? getDisplayName(profile) : undefined}
          authorAvatar={profile ? getProfilePicture(profile) : undefined}
          timestamp={0}
          onclick={() => navigateToEvent(event)}
        />
      {/each}
    </div>
  {/if}
</section>

<!-- Community Activity -->
<section data-testid="dashboard-community-activity">
  <div class="mb-4 flex items-center justify-between">
    <h2 class="text-lg font-bold">{m.dashboard_activity_title()}</h2>
  </div>

  {#if isLoading}
    <div class="flex justify-center py-8">
      <span class="loading loading-md loading-spinner text-primary"></span>
    </div>
  {:else if recentItems.length === 0}
    <div
      class="flex flex-col items-center justify-center rounded-lg border border-base-300 bg-base-200/50 py-12 text-center"
    >
      <FilesIcon class_="mb-3 h-10 w-10 text-base-content/30" />
      <p class="text-base-content/60">{m.dashboard_activity_empty()}</p>
    </div>
  {:else}
    <div class="grid gap-3 sm:grid-cols-2">
      {#each recentItems as event (event.id)}
        {@const cardData = getFeedCardData(event)}
        {@const profile = profiles.get(event.pubkey)}
        {@const communityName = getCommunityName(event)}
        <FeedCard
          title={cardData.title}
          subtitle={cardData.subtitle}
          typeKey={cardData.typeKey}
          kind={event.kind}
          tags={cardData.tags}
          description={communityName || cardData.description}
          authorName={profile ? getDisplayName(profile) : undefined}
          authorAvatar={profile ? getProfilePicture(profile) : undefined}
          timestamp={event.created_at}
          onclick={() => navigateToEvent(event)}
        />
      {/each}
    </div>
  {/if}
</section>
