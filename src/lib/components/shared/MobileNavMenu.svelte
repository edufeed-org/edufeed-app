<script>
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';
  import { getLocale, setLocale, locales } from '$lib/paraglide/runtime';
  import { manager } from '$lib/stores/accounts.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { prefetchCalendarData } from '$lib/loaders/calendar.js';
  import { getTotalUnreadCount } from '$lib/services/inbox-service.svelte.js';
  import { getUnreadDmCount } from '$lib/services/dm-service.svelte.js';
  import ProfileAvatar from './ProfileAvatar.svelte';
  import {
    PeopleIcon,
    SearchIcon,
    CalendarIcon,
    HomeIcon,
    BellIcon,
    MessageSquareIcon
  } from '$lib/components/icons';

  /** @type {{ onClose?: () => void }} */
  let { onClose = () => {} } = $props();

  const languageNames = /** @type {Record<string, string>} */ ({
    en: 'English',
    de: 'Deutsch'
  });

  let currentLocale = $derived(getLocale());

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

  /** @param {string} locale */
  function handleLanguageChange(locale) {
    if (locale !== currentLocale) {
      setLocale(/** @type {any} */ (locale));
    }
    onClose();
  }
</script>

<!-- Navigation Links -->
<li>
  <a href={resolve('/communities')} onclick={onClose}>
    <PeopleIcon class_="w-5 h-5" />
    {m.navbar_communities()}
  </a>
</li>
<li>
  <a href={resolve('/discover')} onclick={onClose}>
    <SearchIcon class_="w-5 h-5" />
    {m.navbar_discover()}
  </a>
</li>
<li>
  <a href={resolve('/calendar')} onclick={onClose} onfocus={prefetchCalendarData}>
    <CalendarIcon class_="w-5 h-5" />
    {m.navbar_calendar()}
  </a>
</li>

<li class="menu-disabled"><hr class="my-1 border-base-300" /></li>

<!-- Auth Section -->
{#if activeAccount}
  <li>
    <a href={resolve('/c/')} onclick={onClose}>
      <HomeIcon class_="w-5 h-5" />
      {m.navbar_dashboard()}
    </a>
  </li>
  <li>
    <a href={resolve('/inbox')} onclick={onClose}>
      <BellIcon class_="w-5 h-5" />
      {m.inbox_bell_label()}
      {#if getTotalUnreadCount() > 0}
        <span class="badge badge-sm badge-primary">{getTotalUnreadCount()}</span>
      {/if}
    </a>
  </li>
  <li>
    <a href={resolve('/c/messages')} onclick={onClose}>
      <MessageSquareIcon class_="w-5 h-5" />
      {m.dm_title()}
      {#if getUnreadDmCount() > 0}
        <span class="badge badge-sm badge-primary">{getUnreadDmCount()}</span>
      {/if}
    </a>
  </li>
  <li>
    <a href={resolve(`/p/${activeAccount.pubkey}`)} onclick={onClose}>
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
    <a href={resolve('/settings')} onclick={onClose}>
      {m.common_settings()}
    </a>
  </li>
  <li>
    <a href={resolve('/imprint')} onclick={onClose}>
      {m.navbar_imprint()}
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
    <a href={resolve('/imprint')} onclick={onClose}>
      {m.navbar_imprint()}
    </a>
  </li>
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
    <button class:active={currentLocale === locale} onclick={() => handleLanguageChange(locale)}>
      {languageNames[locale] || locale}
    </button>
  </li>
{/each}
