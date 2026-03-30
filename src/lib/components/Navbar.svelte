<script>
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';
  import { getLocale, setLocale, locales } from '$lib/paraglide/runtime';
  import { manager } from '$lib/stores/accounts.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { CalendarIcon, PeopleIcon, SearchIcon, MenuIcon, DashboardIcon, BellIcon } from './icons';
  import ProfileAvatar from './shared/ProfileAvatar.svelte';
  import InboxDropdown from './inbox/InboxDropdown.svelte';
  import LanguageSwitcher from './LanguageSwitcher.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { prefetchCalendarData } from '$lib/loaders/calendar.js';
  import { getUnreadCount } from '$lib/services/inbox-service.svelte.js';

  // Use the modal store for opening modals
  const modal = modalStore;

  // Language display names (for inline mobile language switcher)
  const languageNames = /** @type {Record<string, string>} */ ({
    en: 'English',
    de: 'Deutsch'
  });

  let currentLocale = $derived(getLocale());

  // Use $state + $effect for reactive RxJS subscription bridge (Svelte 5 pattern)
  let activeAccount = $state(/** @type {any} */ (null));
  let accountCount = $state(0);

  $effect(() => {
    const subscription = manager.active$.subscribe((account) => {
      activeAccount = account;
    });
    return () => subscription.unsubscribe();
  });

  $effect(() => {
    const subscription = manager.accounts$.subscribe((accounts) => {
      accountCount = accounts.length;
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

  /**
   * Logout the current active account only
   */
  function handleLogoutCurrent() {
    console.log('Navbar: Logging out current account');

    if (activeAccount) {
      manager.removeAccount(activeAccount.id);
    }

    closeDropdown();
  }

  /**
   * Logout all accounts
   */
  function handleLogoutAll() {
    console.log('Navbar: Logging out all accounts');

    if (confirm(m.navbar_logout_all_confirm())) {
      const accounts = [...manager.accounts];
      accounts.forEach((account) => {
        manager.removeAccount(account.id);
      });
    }

    closeDropdown();
  }

  /**
   * Handle language change from mobile menu
   * @param {string} locale
   */
  function handleLanguageChange(locale) {
    if (locale !== currentLocale) {
      setLocale(/** @type {any} */ (locale));
    }
    closeDropdown();
  }
</script>

<div class="navbar bg-base-100 shadow-sm">
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
        <DashboardIcon class_="w-5 h-5" />
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
      <!-- Inbox bell + dropdown -->
      <div class="dropdown dropdown-end">
        <button class="btn relative btn-circle btn-ghost" aria-label={m.inbox_bell_label()}>
          <BellIcon class_="w-5 h-5" />
          {#if getUnreadCount() > 0}
            <span
              class="absolute -top-1 -right-1 badge h-4 min-w-4 badge-sm text-[10px] badge-primary"
            >
              {getUnreadCount() > 99 ? '99+' : getUnreadCount()}
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
          class="dropdown-content menu z-[60] mt-3 w-52 menu-sm rounded-box bg-base-100 p-2 shadow"
        >
          <li>
            <a href={resolve(`/p/${activeAccount.pubkey}`)} class="justify-between">
              {m.common_profile()}
            </a>
          </li>
          <li>
            <button onclick={openLoginModal}>{m.navbar_switch_account()}</button>
          </li>
          <li>
            <a href={resolve('/settings')} onclick={closeDropdown}>{m.common_settings()}</a>
          </li>
          <li><button onclick={handleLogoutCurrent}>{m.navbar_logout_current()}</button></li>
          {#if accountCount > 1}
            <li><button onclick={handleLogoutAll}>{m.navbar_logout_all()}</button></li>
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
      <div tabindex="0" role="button" class="btn btn-circle btn-ghost" aria-label={m.navbar_menu()}>
        <MenuIcon class_="w-6 h-6" />
      </div>
      <ul class="dropdown-content menu z-[60] mt-3 w-56 rounded-box bg-base-100 p-2 shadow-lg">
        <!-- Navigation Links -->
        <li>
          <a href={resolve('/communities')} onclick={closeDropdown}>
            <PeopleIcon class_="w-5 h-5" />
            {m.navbar_communities()}
          </a>
        </li>
        <li>
          <a href={resolve('/discover')} onclick={closeDropdown}>
            <SearchIcon class_="w-5 h-5" />
            {m.navbar_discover()}
          </a>
        </li>
        <li>
          <a href={resolve('/calendar')} onclick={closeDropdown} onfocus={prefetchCalendarData}>
            <CalendarIcon class_="w-5 h-5" />
            {m.navbar_calendar()}
          </a>
        </li>

        <li class="menu-disabled"><hr class="my-1 border-base-300" /></li>

        <!-- Auth Section -->
        {#if activeAccount}
          <li>
            <a href={resolve('/c/')} onclick={closeDropdown}>
              <DashboardIcon class_="w-5 h-5" />
              {m.navbar_dashboard()}
            </a>
          </li>
          <li>
            <a href={resolve('/inbox')} onclick={closeDropdown}>
              <BellIcon class_="w-5 h-5" />
              {m.inbox_bell_label()}
              {#if getUnreadCount() > 0}
                <span class="badge badge-sm badge-primary">{getUnreadCount()}</span>
              {/if}
            </a>
          </li>
          <li>
            <a href={resolve(`/p/${activeAccount.pubkey}`)} onclick={closeDropdown}>
              <ProfileAvatar pubkey={activeAccount.pubkey} size="xs" fallbackType="robohash" />
              {m.common_profile()}
            </a>
          </li>
          <li>
            <button onclick={openLoginModal}>
              {m.navbar_switch_account()}
            </button>
          </li>
          <li>
            <a href={resolve('/settings')} onclick={closeDropdown}>
              {m.common_settings()}
            </a>
          </li>
          <li>
            <button onclick={handleLogoutCurrent}>
              {m.navbar_logout_current()}
            </button>
          </li>
          {#if accountCount > 1}
            <li>
              <button onclick={handleLogoutAll}>
                {m.navbar_logout_all()}
              </button>
            </li>
          {/if}
        {:else}
          <li>
            <button onclick={openLoginModal}>
              {m.common_login()}
            </button>
          </li>
        {/if}

        <li class="menu-disabled"><hr class="my-1 border-base-300" /></li>

        <!-- Language Selection -->
        <li class="menu-title text-xs">{m.navbar_language()}</li>
        {#each locales as locale (locale)}
          <li>
            <button
              class:active={currentLocale === locale}
              onclick={() => handleLanguageChange(locale)}
            >
              {languageNames[locale] || locale}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  </div>
</div>
