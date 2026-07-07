<script>
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import {
    CalendarIcon,
    SearchIcon,
    MenuIcon,
    HomeIcon,
    BellIcon,
    MessageSquareIcon
  } from './icons';
  import ProfileAvatar from './shared/ProfileAvatar.svelte';
  import AccountMenuSection from './shared/AccountMenuSection.svelte';
  import MobileNavMenu from './shared/MobileNavMenu.svelte';
  import InboxDropdown from './inbox/InboxDropdown.svelte';
  import LanguageSwitcher from './LanguageSwitcher.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { prefetchCalendarData } from '$lib/loaders/calendar.js';
  import { getTotalUnreadCount } from '$lib/services/inbox-service.svelte.js';
  import { getUnreadDmCount } from '$lib/services/dm-service.svelte.js';

  /** @type {{ hideMobileNavbar?: boolean }} */
  let { hideMobileNavbar = false } = $props();

  // Use the modal store for opening modals
  const modal = modalStore;

  // Use $state + $effect for reactive RxJS subscription bridge (Svelte 5 pattern)
  let activeAccount = $state(/** @type {any} */ (null));

  $effect(() => {
    const subscription = manager.active$.subscribe((account) => {
      activeAccount = account;
    });
    return () => subscription.unsubscribe();
  });

  /**
   * Open the login modal using the centralized modal store
   * Also closes the dropdown menu if it's open
   */
  function openLoginModal() {
    console.log('Navbar: Opening login modal');
    modal.openModal('login');
    closeDropdown();
  }

  /**
   * Helper to close the dropdown menu
   */
  function closeDropdown() {
    const dropdownTrigger = /** @type {HTMLElement} */ (document.activeElement);
    if (dropdownTrigger && dropdownTrigger.closest('.dropdown')) {
      dropdownTrigger.blur();
    }
  }
</script>

<div class="navbar bg-base-200" class:max-lg:hidden={hideMobileNavbar}>
  <!-- Left: Logo + Brand -->
  <div class="flex flex-1 items-center">
    <div class="avatar">
      <div class="mask w-10 mask-hexagon-2">
        <img src={runtimeConfig.appLogo} alt="App Logo" />
      </div>
    </div>
    <a href={resolve('/')} class="btn text-xl btn-ghost"
      >{m.navbar_brand({ appName: runtimeConfig.appName })}</a
    >
  </div>

  <!-- Center: Nav links (desktop only) -->
  <div class="hidden flex-1 items-center justify-center gap-2 lg:flex">
    <a href={resolve('/discover')} class="btn btn-ghost">
      <SearchIcon class_="w-5 h-5" />
      {m.navbar_discover()}
    </a>
    {#if activeAccount}
      <a href={resolve('/c/')} class="btn btn-ghost">
        <HomeIcon class_="w-5 h-5" />
        {m.navbar_dashboard()}
      </a>
    {/if}
    <a href={resolve('/calendar')} class="btn btn-ghost" onmouseenter={prefetchCalendarData}>
      <CalendarIcon class_="w-5 h-5" />
      {m.navbar_calendar()}
    </a>
  </div>

  <!-- Right: Utility items (desktop only) -->
  <div class="hidden flex-1 items-center justify-end gap-2 lg:flex">
    {#if activeAccount}
      <!-- DM icon -->
      <a
        href={resolve('/c/messages')}
        class="btn relative btn-circle btn-ghost"
        aria-label={m.dm_title()}
      >
        <MessageSquareIcon class_="w-5 h-5" />
        {#if getUnreadDmCount() > 0}
          <span
            class="absolute -top-1 -right-1 badge h-4 min-w-4 badge-sm text-[10px] badge-primary"
          >
            {getUnreadDmCount() > 99 ? '99+' : getUnreadDmCount()}
          </span>
        {/if}
      </a>
      <!-- Inbox bell + dropdown -->
      <div class="dropdown dropdown-end">
        <button class="btn relative btn-circle btn-ghost" aria-label={m.inbox_bell_label()}>
          <BellIcon class_="w-5 h-5" />
          {#if getTotalUnreadCount() > 0}
            <span
              class="absolute -top-1 -right-1 badge h-4 min-w-4 badge-sm text-[10px] badge-primary"
            >
              {getTotalUnreadCount() > 99 ? '99+' : getTotalUnreadCount()}
            </span>
          {/if}
        </button>
        <div class="dropdown-content z-[60] mt-2">
          <InboxDropdown />
        </div>
      </div>
      <!-- Profile dropdown -->
      <div class="dropdown dropdown-end">
        <div tabindex="0" role="button" class="btn btn-circle btn-ghost">
          <ProfileAvatar pubkey={activeAccount.pubkey} size="md" fallbackType="robohash" />
        </div>
        <ul
          class="dropdown-content menu z-[60] mt-3 w-56 menu-sm rounded-box bg-base-100 p-2 shadow"
        >
          <AccountMenuSection onClose={closeDropdown} />
        </ul>
      </div>
    {:else}
      <button onclick={openLoginModal} class="btn btn-ghost">{m.common_login()}</button>
    {/if}
    <LanguageSwitcher />
  </div>

  <!-- Mobile Hamburger Menu (visible below lg) -->
  <div class="lg:hidden">
    <div class="dropdown dropdown-end">
      <div tabindex="0" role="button" class="btn btn-circle btn-ghost" aria-label={m.navbar_menu()}>
        <MenuIcon class_="w-6 h-6" />
      </div>
      <ul class="dropdown-content menu z-[60] mt-3 w-56 rounded-box bg-base-100 p-2 shadow-lg">
        <MobileNavMenu onClose={closeDropdown} />
      </ul>
    </div>
  </div>
</div>
