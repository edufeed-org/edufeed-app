<script>
  import { page } from '$app/stores';
  import { manager } from '$lib/stores/accounts.svelte';
  import { appSettings } from '$lib/stores/app-settings.svelte.js';
  import * as m from '$lib/paraglide/messages';
  import DashboardHome from '$lib/components/dashboard/DashboardHome.svelte';
  import DashboardCommunityFeed from '$lib/components/dashboard/DashboardCommunityFeed.svelte';
  import DashboardFollowsFeed from '$lib/components/dashboard/DashboardFollowsFeed.svelte';
  import DashboardMyStuff from '$lib/components/dashboard/DashboardMyStuff.svelte';
  import DashboardCommunities from '$lib/components/dashboard/DashboardCommunities.svelte';

  let activeSection = $derived.by(() => {
    const view = $page.url.searchParams.get('view') || 'home';
    // Backward compat: old 'your-content' URL maps to 'my-stuff'
    return view === 'your-content' ? 'my-stuff' : view;
  });
</script>

<svelte:head><title>{m.dashboard_title()}</title></svelte:head>

<div class="mx-auto w-full max-w-4xl px-4 py-6">
  {#if activeSection === 'my-stuff'}
    <DashboardMyStuff pubkey={manager.active?.pubkey ?? ''} />
  {:else if activeSection === 'communities'}
    <DashboardCommunities />
  {:else if activeSection === 'feed'}
    {#if appSettings.dashboardFeedSource === 'following'}
      <DashboardFollowsFeed />
    {:else}
      <DashboardCommunityFeed />
    {/if}
  {:else}
    <DashboardHome />
  {/if}
</div>
