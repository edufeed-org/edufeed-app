<script>
  import { page } from '$app/stores';
  import { manager } from '$lib/stores/accounts.svelte';
  import { appSettings } from '$lib/stores/app-settings.svelte.js';
  import * as m from '$lib/paraglide/messages';
  import DashboardCommunityFeed from '$lib/components/dashboard/DashboardCommunityFeed.svelte';
  import DashboardFollowsFeed from '$lib/components/dashboard/DashboardFollowsFeed.svelte';
  import DashboardFeedSelector from '$lib/components/dashboard/DashboardFeedSelector.svelte';
  import DashboardYourContent from '$lib/components/dashboard/DashboardYourContent.svelte';
  import DashboardCommunities from '$lib/components/dashboard/DashboardCommunities.svelte';

  let activeSection = $derived($page.url.searchParams.get('view') || 'feed');
</script>

<svelte:head><title>{m.dashboard_title()}</title></svelte:head>

<div class="mx-auto max-w-4xl px-4 py-6">
  {#if activeSection === 'your-content'}
    <DashboardYourContent pubkey={manager.active?.pubkey ?? ''} />
  {:else if activeSection === 'communities'}
    <DashboardCommunities />
  {:else}
    <div class="mb-3">
      <DashboardFeedSelector />
    </div>
    {#if appSettings.dashboardFeedSource === 'following'}
      <DashboardFollowsFeed />
    {:else}
      <DashboardCommunityFeed />
    {/if}
  {/if}
</div>
