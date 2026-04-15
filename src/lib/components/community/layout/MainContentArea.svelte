<script>
  import { getContext } from 'svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import Chat from '../views/Chat.svelte';
  import CalendarView from '$lib/components/calendar/CalendarView.svelte';
  import LearningView from '../views/LearningView.svelte';
  import BoardsView from '../views/BoardsView.svelte';
  import ArticlesView from '../views/ArticlesView.svelte';
  import ForumView from '../views/ForumView.svelte';
  import WikisView from '../views/WikisView.svelte';
  import SocialBookmarksView from '../views/SocialBookmarksView.svelte';
  import MeetView from '$lib/components/meet/MeetView.svelte';
  import MembersView from '../views/MembersView.svelte';
  import HomeView from '../views/HomeView.svelte';
  import SettingsView from '../views/SettingsView.svelte';
  import AccessGateBanner from '$lib/components/forms/AccessGateBanner.svelte';
  import { manager } from '$lib/stores/accounts.svelte';
  import { getSectionNameForContentType } from '$lib/helpers/contentTypes.js';
  import * as m from '$lib/paraglide/messages';

  let { selectedCommunityId, selectedContentType, onKindNavigation } = $props();

  // Consume shared data from layout context (eliminates duplicate loading)
  const getCommunikeyEvent = getContext('communikeyEvent');
  const getCommunityProfile = getContext('communityProfile');
  const getCommunikeyLoaded = getContext('communikeyLoaded');
  const profileAccess = getContext('profileAccess');
  const getIsMember = getContext('isCommunityMember');

  let communikeyEvent = $derived(getCommunikeyEvent());
  let communityProfile = $derived(getCommunityProfile());
  let isLoading = $derived(!getCommunikeyLoaded());
</script>

<!-- Main Content Area -->
<div
  class="min-h-0 flex-1 transition-all duration-300 lg:ml-(--sidebar-nav-w)"
  class:overflow-auto={selectedContentType !== 'chat'}
  class:overflow-hidden={selectedContentType === 'chat'}
>
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
      {@const sectionName = getSectionNameForContentType(communikeyEvent, selectedContentType)}
      {@const formRef = sectionName ? profileAccess.getFormRef(sectionName) : null}
      {@const userPubkey = manager.active?.pubkey}
      {@const canPublish = sectionName ? profileAccess.canPublish(sectionName) : true}

      {#if userPubkey && getIsMember() && !canPublish && formRef && !profileAccess.isLoading}
        <AccessGateBanner {formRef} {sectionName} {userPubkey} />
      {/if}

      {#if selectedContentType === 'home'}
        <HomeView
          {communikeyEvent}
          profileEvent={communityProfile}
          communityId={selectedCommunityId}
          {onKindNavigation}
        />
      {:else if selectedContentType === 'chat'}
        <Chat
          {communikeyEvent}
          {communityProfile}
          communityPubkey={selectedCommunityId}
          {canPublish}
        />
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
        <ForumView communityPubkey={selectedCommunityId} {communityProfile} {canPublish} />
      {:else if selectedContentType === 'wikis'}
        <WikisView communityPubkey={selectedCommunityId} {communityProfile} />
      {:else if selectedContentType === 'social-bookmarks'}
        <SocialBookmarksView communityPubkey={selectedCommunityId} {communityProfile} />
      {:else if selectedContentType === 'meet'}
        <MeetView communityPubkey={selectedCommunityId} {communityProfile} />
      {:else if selectedContentType === 'members'}
        <MembersView {communikeyEvent} />
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
