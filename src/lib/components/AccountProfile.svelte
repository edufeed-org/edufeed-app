<script>
  let { account } = $props();

  import { manager } from '$lib/stores/accounts.svelte';
  import { getProfilePicture } from 'applesauce-core/helpers';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import * as m from '$lib/paraglide/messages';

  const getProfile = useUserProfile(() => account.pubkey);

  // Reactive state for active account to trigger re-renders
  let activeAccount = $state(manager.active);

  // Subscribe to active account changes
  $effect(() => {
    const subscription = manager.active$.subscribe((account) => {
      activeAccount = account;
    });
    return () => subscription.unsubscribe();
  });
</script>

<div class="flex w-full items-center rounded-md border border-primary/40 p-2">
  <div tabindex="0" role="button" class="btn avatar btn-circle btn-ghost">
    <div class="w-10 rounded-full">
      <img
        alt=""
        src={getProfilePicture(getProfile()) || `https://robohash.org/${account.pubkey}`}
      />
    </div>
  </div>
  <li>
    {getProfile()?.name || account.pubkey.slice(0, 8) + '...'}

    {#if account.type === 'nostr-connect'}
      <span class="ml-1 badge badge-outline badge-sm">{m.auth_bunker_account_type()}</span>
    {/if}
    {#if account.type === 'readonly'}
      <span class="ml-1 badge badge-outline badge-sm badge-warning"
        >{m.auth_readonly_account_type()}</span
      >
    {/if}
    {#if account === activeAccount}
      {m.account_profile_active_status()}
    {/if}
  </li>
  <button
    class="btn mr-2 ml-auto"
    disabled={account === activeAccount}
    onclick={() => manager.setActive(account)}
  >
    {account === activeAccount
      ? m.account_profile_active_button()
      : m.account_profile_set_active_button()}
  </button>
</div>
