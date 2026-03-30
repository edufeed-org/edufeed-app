<script>
  import { page } from '$app/stores';
  import { manager } from '$lib/stores/accounts.svelte';
  import * as m from '$lib/paraglide/messages';
  import DashboardCommunityFeed from '$lib/components/dashboard/DashboardCommunityFeed.svelte';
  import DashboardYourContent from '$lib/components/dashboard/DashboardYourContent.svelte';
  import DashboardCommunities from '$lib/components/dashboard/DashboardCommunities.svelte';

  let activeSection = $derived($page.url.searchParams.get('view') || 'feed');
</script>

<svelte:head><title>{m.dashboard_title()}</title></svelte:head>

<div class="mx-auto max-w-4xl px-4 py-6">
  {#if activeSection === 'your-content'}
    <DashboardYourContent pubkey={manager.active?.pubkey} />
  {:else if activeSection === 'communities'}
    <DashboardCommunities />
  {:else}
    <DashboardCommunityFeed />
  {/if}
</div>
