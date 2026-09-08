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
  import ImageWithFallback from './shared/ImageWithFallback.svelte';
  import { lazyComponent } from '$lib/helpers/lazy-component.svelte.js';
  import LanguageSwitcher from './LanguageSwitcher.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { prefetchCalendarData } from '$lib/loaders/calendar.js';
  import { getTotalUnreadCount } from '$lib/services/inbox-service.svelte.js';
  import { getPendingInviteCount } from '$lib/concord/pending-invites.svelte.js';

  // Pending E2E invites ride the SAME bell as notifications — the one global
  // surface users check when they expect "something arrived" (UX consult
  // 2026-08-17; the dashboard card + Termi hint alone were missed in testing).
  const bellCount = $derived(getTotalUnreadCount() + getPendingInviteCount());
  import { getUnreadDmCount } from '$lib/services/dm-service.svelte.js';

  // Dropdown bodies load on first hover/focus of their trigger rather than
  // statically: Navbar is in the root layout, so a static import would put
  // the inbox list, account menu and mobile menu (~85KB) into every page's
  // preload set. DaisyUI dropdowns open on focus, so `focusin` on the trigger
  // fires before the body is visible; `pointerenter` warms it on hover.
  const lazyInboxDropdown = lazyComponent(() => import('./inbox/InboxDropdown.svelte'));
  const lazyAccountMenu = lazyComponent(() => import('./shared/AccountMenuSection.svelte'));
  const lazyMobileNavMenu = lazyComponent(() => import('./shared/MobileNavMenu.svelte'));

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
        <ImageWithFallback
          src={runtimeConfig.appLogo}
          alt="App Logo"
          fallbackType="generic"
          class="h-full w-full object-cover"
        />
      </div>
    </div>
    <a href={resolve('/')} class="btn text-xl btn-ghost"
      >{m.navbar_brand({ appName: runtimeConfig.appName })}</a
    >
    <span class="badge badge-outline badge-primary" data-testid="navbar-beta-badge"
      >{m.navbar_beta_badge()}</span
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
        <button
          class="btn relative btn-circle btn-ghost"
          aria-label={m.inbox_bell_label()}
          onpointerenter={lazyInboxDropdown.load}
          onfocusin={lazyInboxDropdown.load}
        >
          <BellIcon class_="w-5 h-5" />
          {#if bellCount > 0}
            <span
              class="absolute -top-1 -right-1 badge h-4 min-w-4 badge-sm text-[10px] badge-primary"
            >
              {bellCount > 99 ? '99+' : bellCount}
            </span>
          {/if}
        </button>
        <div class="dropdown-content z-[60] mt-2">
          {#if lazyInboxDropdown.loaded}
            {@const InboxDropdown = lazyInboxDropdown.loaded}
            <InboxDropdown />
          {/if}
        </div>
      </div>
      <!-- Profile dropdown -->
      <div class="dropdown dropdown-end">
        <div
          tabindex="0"
          role="button"
          class="btn btn-circle btn-ghost"
          onpointerenter={lazyAccountMenu.load}
          onfocusin={lazyAccountMenu.load}
        >
          <ProfileAvatar pubkey={activeAccount.pubkey} size="md" fallbackType="robohash" />
        </div>
        <ul
          class="dropdown-content menu z-[60] mt-3 w-56 menu-sm rounded-box bg-base-100 p-2 shadow"
        >
          {#if lazyAccountMenu.loaded}
            {@const AccountMenuSection = lazyAccountMenu.loaded}
            <AccountMenuSection onClose={closeDropdown} />
          {/if}
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
      <div
        tabindex="0"
        role="button"
        class="btn btn-circle btn-ghost"
        aria-label={m.navbar_menu()}
        onpointerenter={lazyMobileNavMenu.load}
        onfocusin={lazyMobileNavMenu.load}
      >
        <MenuIcon class_="w-6 h-6" />
      </div>
      <ul class="dropdown-content menu z-[60] mt-3 w-56 rounded-box bg-base-100 p-2 shadow-lg">
        {#if lazyMobileNavMenu.loaded}
          {@const MobileNavMenu = lazyMobileNavMenu.loaded}
          <MobileNavMenu onClose={closeDropdown} />
        {/if}
      </ul>
    </div>
  </div>
</div>
