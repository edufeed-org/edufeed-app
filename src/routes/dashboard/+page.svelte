<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { manager } from '$lib/stores/accounts.svelte';
  import * as m from '$lib/paraglide/messages';
  import DashboardCommunities from '$lib/components/dashboard/DashboardCommunities.svelte';
  import DashboardCommunityFeed from '$lib/components/dashboard/DashboardCommunityFeed.svelte';
  import DashboardFormRequests from '$lib/components/dashboard/DashboardFormRequests.svelte';
  import DashboardYourContent from '$lib/components/dashboard/DashboardYourContent.svelte';

  let activeAccount = $state(/** @type {any} */ (null));
  let initialized = $state(false);

  // Subscribe to active account
  $effect(() => {
    const subscription = manager.active$.subscribe((account) => {
      activeAccount = account;
      initialized = true;
    });
    return () => subscription.unsubscribe();
  });

  // Auth guard: redirect to home if not logged in
  $effect(() => {
    if (initialized && !activeAccount) {
      goto(resolve('/'));
    }
  });
</script>

<svelte:head>
  <title>{m.dashboard_title()}</title>
</svelte:head>

{#if activeAccount}
  <div class="mx-auto max-w-5xl px-4 py-6">
    <h1 class="mb-6 text-2xl font-bold">{m.dashboard_title()}</h1>

    <div class="flex flex-col gap-8">
      <DashboardCommunities />
      <DashboardCommunityFeed />
      <DashboardFormRequests pubkey={activeAccount.pubkey} />
      <DashboardYourContent pubkey={activeAccount.pubkey} />
    </div>
  </div>
{:else if !initialized}
  <div class="flex justify-center py-16">
    <span class="loading loading-lg loading-spinner text-primary"></span>
  </div>
{/if}
