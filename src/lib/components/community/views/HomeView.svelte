<script>
  import CommunityProfileHero from './CommunityProfileHero.svelte';
  import FeedCard from '$lib/components/shared/FeedCard.svelte';
  import { getFeedCardData } from '$lib/helpers/feedCardData.js';
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useCommunityActivityLoader } from '$lib/loaders/community-activity.js';
  import { CommunityActivityModel } from '$lib/models/community-content.js';
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
    <!-- Community Profile Hero -->
    <CommunityProfileHero
      {communityId}
      {communikeyEvent}
      {profileEvent}
      onNavigateToAbout={() => onKindNavigation?.('settings')}
    />

    <!-- Main Content -->
    <div class="container mx-auto max-w-4xl px-4 py-8">
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
                timestamp={event.created_at}
              />
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
