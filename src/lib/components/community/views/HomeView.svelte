<script>
  import CommunikeyHeader from '$lib/components/CommunikeyHeader.svelte';
  import { getCommunityAvailableContentTypes } from '$lib/helpers/contentTypes.js';

  // Import stat components
  import CalendarEventsStat from '$lib/components/community/stats/CalendarEventsStat.svelte';
  import MessagesStat from '$lib/components/community/stats/MessagesStat.svelte';
  import * as m from '$lib/paraglide/messages';

  let { communikeyEvent, profileEvent, communityId, onKindNavigation } = $props();

  let contentTypes = $derived(
    communikeyEvent ? getCommunityAvailableContentTypes(communikeyEvent) : []
  );
</script>

{#if profileEvent && communikeyEvent}
  <div class="bg-base-100">
    <!-- Community Header -->
    <CommunikeyHeader
      {communikeyEvent}
      profile={profileEvent}
      communikeyContentTypes={contentTypes}
      activeTab={undefined}
      onTabChange={onKindNavigation}
    />

    <!-- Main Content -->
    <div class="container mx-auto max-w-4xl px-4 py-8">
      <!-- Quick Stats -->
      <div class="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        <CalendarEventsStat {communityId} />
        <MessagesStat {communityId} />
      </div>

      <!-- Community Description -->
      {#if communikeyEvent?.content}
        <div class="card mb-8 bg-base-200 shadow-xl">
          <div class="card-body">
            <h2 class="card-title">{m.community_views_home_about_title()}</h2>
            <p class="text-base-content/80">{communikeyEvent.content}</p>
          </div>
        </div>
      {/if}

      <!-- Recent Activity Section (Placeholder) -->
      <div class="card bg-base-200 shadow-xl">
        <div class="card-body">
          <h2 class="mb-4 card-title">{m.community_views_home_recent_activity_title()}</h2>
          <div class="py-8 text-center text-base-content/60">
            <p class="text-sm">{m.community_views_home_recent_activity_empty()}</p>
            <p class="mt-2 text-xs">{m.community_views_home_recent_activity_description()}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
{:else}
  <div class="flex h-full items-center justify-center">
    <div class="loading loading-lg loading-spinner text-primary"></div>
  </div>
{/if}
