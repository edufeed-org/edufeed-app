<script>
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';

  let activeAccount = $state(/** @type {any} */ (null));

  $effect(() => {
    const sub = manager.active$.subscribe((account) => {
      activeAccount = account;
    });
    return () => sub.unsubscribe();
  });
</script>

{#if activeAccount?.type === 'readonly'}
  <div class="mb-4 alert alert-warning" data-testid="readonly-notice" role="status">
    <span class="text-sm">{m.readonly_sign_prompt()}</span>
  </div>
{/if}
