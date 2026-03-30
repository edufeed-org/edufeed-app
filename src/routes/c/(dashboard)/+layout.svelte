<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { manager } from '$lib/stores/accounts.svelte';
  import DashboardNavSidebar from '$lib/components/dashboard/DashboardNavSidebar.svelte';
  import DashboardBottomTabBar from '$lib/components/dashboard/DashboardBottomTabBar.svelte';

  let { children } = $props();

  let activeAccount = $state(/** @type {any} */ (null));
  let initialized = $state(false);

  $effect(() => {
    const sub = manager.active$.subscribe((account) => {
      activeAccount = account;
      initialized = true;
    });
    return () => sub.unsubscribe();
  });

  $effect(() => {
    if (initialized && !activeAccount) goto(resolve('/'));
  });
</script>

{#if activeAccount}
  <!-- Desktop: nav sidebar + content -->
  <DashboardNavSidebar />
  <div class="hidden flex-1 overflow-auto lg:ml-60 lg:block">
    {@render children()}
  </div>

  <!-- Mobile: content + bottom tab bar -->
  <div class="flex-1 overflow-auto pb-16 lg:hidden">
    {@render children()}
  </div>
  <DashboardBottomTabBar />
{:else if !initialized}
  <div class="flex flex-1 items-center justify-center">
    <span class="loading loading-lg loading-spinner text-primary"></span>
  </div>
{/if}
