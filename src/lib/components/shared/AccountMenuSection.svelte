<!--
  AccountMenuSection — shared menu block for the active account.

  Used by Navbar.svelte (desktop profile dropdown) and MobileNavMenu.svelte
  (mobile hamburger menu). Renders an identity header followed by four
  separated groups: personal actions, account management, info, destructive.

  The consumer wraps this in a <ul class="menu …"> (or equivalent) and passes
  an `onClose` callback that is fired after every interactive row.
-->

<script>
  import { resolve } from '$app/paths';
  import { getDisplayName } from 'applesauce-core/helpers';
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import ProfileAvatar from './ProfileAvatar.svelte';
  import { PersonIcon, GearIcon, ArrowLeftRightIcon, InfoCircleIcon } from '$lib/components/icons';

  /** @type {{ onClose?: () => void }} */
  let { onClose = () => {} } = $props();

  // Reactive bridge to RxJS (same pattern as Navbar.svelte:33-45).
  let activeAccount = $state(/** @type {any} */ (null));
  let accountCount = $state(0);

  $effect(() => {
    const sub = manager.active$.subscribe((account) => {
      activeAccount = account;
    });
    return () => sub.unsubscribe();
  });

  $effect(() => {
    const sub = manager.accounts$.subscribe((accounts) => {
      accountCount = accounts.length;
    });
    return () => sub.unsubscribe();
  });

  const getProfile = useUserProfile(() => activeAccount?.pubkey);
  const displayName = $derived(
    getDisplayName(getProfile(), activeAccount?.pubkey?.slice(0, 8) ?? '')
  );

  function openLoginModal() {
    modalStore.openModal('login');
    onClose();
  }

  function handleLogoutCurrent() {
    if (activeAccount) {
      manager.removeAccount(activeAccount.id);
    }
    onClose();
  }

  function handleLogoutAll() {
    if (confirm(m.navbar_logout_all_confirm())) {
      const accounts = [...manager.accounts];
      accounts.forEach((account) => {
        manager.removeAccount(account.id);
      });
    }
    onClose();
  }
</script>

{#if activeAccount}
  <!-- Identity header (display only) -->
  <li class="menu-disabled pointer-events-none">
    <div class="flex min-w-0 items-center gap-3 py-2">
      <ProfileAvatar pubkey={activeAccount.pubkey} size="sm" fallbackType="robohash" />
      <span class="min-w-0 flex-1 truncate font-medium text-base-content" title={displayName}
        >{displayName}</span
      >
    </div>
  </li>

  <li class="menu-disabled"><hr class="my-1 border-base-300" /></li>

  <!-- Group 1: personal actions -->
  <li>
    <a href={resolve(`/p/${activeAccount.pubkey}`)} onclick={onClose}>
      <PersonIcon class_="w-4 h-4" />
      {m.common_profile()}
    </a>
  </li>
  <li>
    <a href={resolve('/settings')} onclick={onClose}>
      <GearIcon class_="w-4 h-4" />
      {m.common_settings()}
    </a>
  </li>

  <li class="menu-disabled"><hr class="my-1 border-base-300" /></li>

  <!-- Group 2: account management -->
  <li>
    <button onclick={openLoginModal}>
      <ArrowLeftRightIcon class_="w-4 h-4" />
      <span class="flex-1">{m.navbar_switch_account()}</span>
      {#if accountCount > 1}
        <span class="badge badge-ghost badge-sm" data-testid="account-count-badge">
          {accountCount}
        </span>
      {/if}
    </button>
  </li>

  <li class="menu-disabled"><hr class="my-1 border-base-300" /></li>

  <!-- Group 3: info -->
  <li>
    <a href={resolve('/imprint')} onclick={onClose}>
      <InfoCircleIcon class_="w-4 h-4" />
      {m.navbar_imprint()}
    </a>
  </li>

  <li class="menu-disabled"><hr class="my-1 border-base-300" /></li>

  <!-- Group 4: destructive -->
  <li>
    <button class="text-error" onclick={handleLogoutCurrent}>
      {m.navbar_logout_current()}
    </button>
  </li>
  {#if accountCount > 1}
    <li>
      <button class="text-error" onclick={handleLogoutAll}>
        {m.navbar_logout_all()}
      </button>
    </li>
  {/if}
{/if}
