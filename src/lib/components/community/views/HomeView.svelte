<script>
  import CommunikeyHeader from '$lib/components/CommunikeyHeader.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useCommunityActivityLoader } from '$lib/loaders/community-activity.js';
  import { CommunityActivityModel } from '$lib/models/community-content.js';
  import { formatAMBResource } from '$lib/helpers/educational/index.js';
  import { getCalendarEventMetadata } from '$lib/helpers/eventUtils';
  import CalendarEventCard from '$lib/components/calendar/CalendarEventCard.svelte';
  import AMBResourceCard from '$lib/components/educational/AMBResourceCard.svelte';
  import ArticleCard from '$lib/components/article/ArticleCard.svelte';
  import KanbanBoardCard from '$lib/components/kanban/KanbanBoardCard.svelte';
  import WikiCard from '$lib/components/wiki/WikiCard.svelte';
  import ThreadCard from '$lib/components/thread/ThreadCard.svelte';
  import * as m from '$lib/paraglide/messages';

  let { communikeyEvent, profileEvent, communityId, onKindNavigation } = $props();

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

    const { cleanup } = useCommunityActivityLoader(pubkey);

    const modelSub = eventStore.model(CommunityActivityModel, pubkey).subscribe({
      next: (loaded) => {
        const sorted = [...(loaded || [])].sort((a, b) => b.created_at - a.created_at).slice(0, 10);
        feedItems = sorted;
        isLoadingFeed = false;
      },
      error: (err) => {
        console.error('HomeView: Error loading activity feed:', err);
        isLoadingFeed = false;
      }
    });

    loaderCleanup = () => {
      modelSub.unsubscribe();
      cleanup();
    };

    return () => {
      if (loaderCleanup) {
        loaderCleanup();
        loaderCleanup = null;
      }
    };
  });
</script>

{#if profileEvent && communikeyEvent}
  <div class="bg-base-100">
    <!-- Community Header -->
    <CommunikeyHeader
      {communikeyEvent}
      profile={profileEvent}
      communikeyContentTypes={[]}
      activeTab={undefined}
      onTabChange={onKindNavigation}
    />

    <!-- Main Content -->
    <div class="container mx-auto max-w-4xl px-4 py-8">
      <!-- Community Description -->
      {#if communikeyEvent?.content}
        <div class="card mb-8 bg-base-200 shadow-xl">
          <div class="card-body">
            <h2 class="card-title">{m.community_views_home_about_title()}</h2>
            <p class="text-base-content/80">{communikeyEvent.content}</p>
          </div>
        </div>
      {/if}

      <!-- Recent Activity Feed -->
      <div>
        <h2 class="mb-4 text-xl font-bold">{m.community_views_home_recent_activity_title()}</h2>

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
              {#if event.kind === 31922 || event.kind === 31923}
                <CalendarEventCard event={getCalendarEventMetadata(event)} compact />
              {:else if event.kind === 30142}
                <AMBResourceCard
                  resource={formatAMBResource(event)}
                  authorProfile={profile}
                  compact
                />
              {:else if event.kind === 30023}
                <ArticleCard article={event} authorProfile={profile} compact />
              {:else if event.kind === 30301}
                <KanbanBoardCard board={event} authorProfile={profile} compact />
              {:else if event.kind === 30818}
                <WikiCard wiki={event} authorProfile={profile} compact />
              {:else if event.kind === 11}
                <ThreadCard thread={event} authorProfile={profile} />
              {/if}
            {/each}
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
