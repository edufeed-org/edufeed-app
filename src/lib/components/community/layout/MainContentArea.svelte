<script>
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { ProfileModel } from 'applesauce-core/models';
  import { profileLoader } from '$lib/loaders/profile.js';
  import { addressLoader } from '$lib/loaders/base.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import Chat from '../views/Chat.svelte';
  import CalendarView from '$lib/components/calendar/CalendarView.svelte';
  import LearningView from '../views/LearningView.svelte';
  import BoardsView from '../views/BoardsView.svelte';
  import ArticlesView from '../views/ArticlesView.svelte';
  import ForumView from '../views/ForumView.svelte';
  import WikisView from '../views/WikisView.svelte';
  import HomeView from '../views/HomeView.svelte';
  import SettingsView from '../views/SettingsView.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * Get communikey relays from app config
   * @returns {string[]}
   */
  function getCommunikeyRelays() {
    return [
      ...(runtimeConfig.appRelays?.communikey || []),
      ...(runtimeConfig.fallbackRelays || [])
    ];
  }

  let { selectedCommunityId, selectedContentType, onKindNavigation } = $props();

  let communikeyEvent = $state(/** @type {any} */ (null));
  let communityProfile = $state(/** @type {any} */ (null));
  let isLoading = $state(true);

  // Load community profile with proper reactivity to selectedCommunityId changes
  $effect(() => {
    // Reset profile when community changes
    communityProfile = null;

    if (selectedCommunityId) {
      // 1. Trigger loader to fetch profile from relays
      const loaderSub = profileLoader({
        kind: 0,
        pubkey: selectedCommunityId,
        relays: getCommunikeyRelays()
      }).subscribe(() => {
        // Loader automatically populates eventStore
      });

      // 2. Subscribe to model for reactive parsed profile from eventStore
      const modelSub = eventStore
        .model(ProfileModel, selectedCommunityId)
        .subscribe((profileContent) => {
          communityProfile = profileContent;
        });

      // Cleanup subscriptions when community changes
      return () => {
        loaderSub.unsubscribe();
        modelSub.unsubscribe();
      };
    }
  });

  // Communikey Creation Pointer
  $effect(() => {
    if (selectedCommunityId) {
      isLoading = true;
      let loaderDone = false;

      const pointer = {
        kind: 10222,
        pubkey: selectedCommunityId
      };

      // 1. Trigger loader to fetch community event from relays
      const loaderSub = addressLoader({
        ...pointer,
        relays: getCommunikeyRelays()
      }).subscribe({
        complete: () => {
          loaderDone = true;
          // If no event found after loader finishes, stop loading anyway
          if (!communikeyEvent) isLoading = false;
        }
      });

      // 2. Subscribe to eventStore for reactive updates
      const sub = eventStore.replaceable(pointer).subscribe((event) => {
        communikeyEvent = event || null;
        // Only stop loading when event arrives OR loader already finished
        if (event || loaderDone) isLoading = false;
      });

      return () => {
        loaderSub.unsubscribe();
        sub.unsubscribe();
      };
    } else {
      communikeyEvent = null;
      isLoading = false;
    }
  });
</script>

<!-- Main Content Area -->
<div class="flex-1 overflow-auto transition-all duration-300 lg:ml-[304px]">
  {#if !selectedCommunityId}
    <!-- Empty state: No community selected -->
    <div class="flex h-full flex-col items-center justify-center p-8 text-center">
      <div class="max-w-md">
        <h2 class="mb-4 text-2xl font-bold text-base-content">
          {m.community_layout_main_content_welcome_title({ appName: runtimeConfig.appName })}
        </h2>
        <p class="mb-6 text-base-content/60">
          {m.community_layout_main_content_welcome_description()}
        </p>
      </div>
    </div>
  {:else if isLoading}
    <!-- Loading state -->
    <div class="flex h-full items-center justify-center">
      <div class="loading loading-lg loading-spinner text-primary"></div>
    </div>
  {:else}
    <!-- Key block ensures views remount when community changes -->
    {#key selectedCommunityId}
      {#if selectedContentType === 'home'}
        <HomeView
          {communikeyEvent}
          profileEvent={communityProfile}
          communityId={selectedCommunityId}
          {onKindNavigation}
        />
      {:else if selectedContentType === 'chat'}
        <Chat {communikeyEvent} {communityProfile} communityPubkey={selectedCommunityId} />
      {:else if selectedContentType === 'calendar'}
        <CalendarView
          communityPubkey={selectedCommunityId}
          communityMode={true}
          {communityProfile}
        />
      {:else if selectedContentType === 'learning'}
        <LearningView communityPubkey={selectedCommunityId} {communityProfile} />
      {:else if selectedContentType === 'boards'}
        <BoardsView communityPubkey={selectedCommunityId} {communityProfile} />
      {:else if selectedContentType === 'articles'}
        <ArticlesView communityPubkey={selectedCommunityId} {communityProfile} />
      {:else if selectedContentType === 'forum'}
        <ForumView communityPubkey={selectedCommunityId} {communityProfile} />
      {:else if selectedContentType === 'wikis'}
        <WikisView communityPubkey={selectedCommunityId} {communityProfile} />
      {:else if selectedContentType === 'settings'}
        <SettingsView
          communityId={selectedCommunityId}
          {communikeyEvent}
          profileEvent={communityProfile}
        />
      {/if}
    {/key}
  {/if}
</div>
