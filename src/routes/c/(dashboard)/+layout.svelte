<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { accountsRestored, manager } from '$lib/stores/accounts.svelte';

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

  // the boot emission comes before the restore: redirecting on it drops a deep link's query
  $effect(() => {
    if (!initialized || activeAccount) return;
    let stale = false;
    void accountsRestored.then(() => {
      if (!stale && !manager.active) goto(resolve('/'));
    });
    return () => (stale = true);
  });
</script>

{#if activeAccount}
  {@render children()}
{:else if !initialized}
  <div class="flex flex-1 items-center justify-center">
    <span class="loading loading-lg loading-spinner text-primary"></span>
  </div>
{/if}
