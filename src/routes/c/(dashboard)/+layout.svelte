<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { manager } from '$lib/stores/accounts.svelte';

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
  {@render children()}
{:else if !initialized}
  <div class="flex flex-1 items-center justify-center">
    <span class="loading loading-lg loading-spinner text-primary"></span>
  </div>
{/if}
