<!--
  MobileMenuSheet — the phone's account + navigation menu as a bottom sheet.

  Opened from the avatar in the /c header and from the Navbar's mobile
  trigger (avatar when logged in, hamburger when logged out). It replaced the
  DaisyUI dropdown that stacked the old MobileNavMenu on top of
  AccountMenuSection: 20 rows in a w-56 popover, taller than the screen, no
  scroll (laoc, 2026-11-04).

  Order, logged in: identity → Profil / Einstellungen / QR-Code tiles (what
  people reach for) → the inbox group the dock hides behind chat composers
  plus Kalender (nothing else on the phone links it) → account plumbing →
  help & feedback → quiet rows (language, connection, legal) → logout.
  Deliberately absent: Entdecken and Gruppen (the dock has them) and
  Schlüssel sichern (lives in Einstellungen). The desktop dropdown keeps
  AccountMenuSection; the shared actions live in helpers/account-menu-actions.
-->

<script>
  import { resolve } from '$app/paths';
  import { getDisplayName } from 'applesauce-core/helpers';
  import * as m from '$lib/paraglide/messages';
  import { getLocale, setLocale, locales } from '$lib/paraglide/runtime';
  import { manager } from '$lib/stores/accounts.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { useMembershipPendingCount } from '$lib/stores/membership-pending.svelte.js';
  import { getTotalUnreadCount } from '$lib/services/inbox-service.svelte.js';
  import { getUnreadDmCount } from '$lib/services/dm-service.svelte.js';
  import { prefetchCalendarData } from '$lib/loaders/calendar.js';
  import { profileLink } from '$lib/helpers/nostrUtils.js';
  import { shortNpub } from '$lib/helpers/pubkey.js';
  import { helpLinkAttrs } from '$lib/helpers/help-link.js';
  import { openOwnQrCode, logoutCurrent, logoutAll } from '$lib/helpers/account-menu-actions.js';
  import BottomSheet from './BottomSheet.svelte';
  import ProfileAvatar from './ProfileAvatar.svelte';
  import ConnectionStatus from './ConnectionStatus.svelte';
  import {
    PersonIcon,
    GearIcon,
    QrCodeIcon,
    BellIcon,
    MessageSquareIcon,
    FilesIcon,
    CalendarIcon,
    SearchIcon,
    PeopleIcon,
    CheckIcon,
    ArrowLeftRightIcon,
    QuestionCircleIcon,
    ChatTextIcon,
    InfoCircleIcon
  } from '$lib/components/icons';

  /** @type {{ open: boolean, onClose: () => void }} */
  let { open, onClose } = $props();

  const languageNames = /** @type {Record<string, string>} */ ({ en: 'English', de: 'Deutsch' });
  let currentLocale = $derived(getLocale());

  // Reactive bridge to RxJS (same pattern as AccountMenuSection).
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
  const npubShort = $derived(shortNpub(activeAccount?.pubkey));
  const displayName = $derived(getDisplayName(getProfile(), npubShort));

  const isMembershipAdmin = $derived(
    !!activeAccount?.pubkey &&
      (runtimeConfig.membership?.adminPubkeys || []).includes(activeAccount.pubkey)
  );
  const pendingMembershipCount = useMembershipPendingCount();
  const helpLink = $derived(helpLinkAttrs(runtimeConfig.help?.url));

  function openLoginModal() {
    modalStore.openModal('login');
    onClose();
  }

  function openReportIssue() {
    onClose();
    modalStore.openModal('reportIssue');
  }

  /** @param {string} locale */
  function handleLanguageChange(locale) {
    if (locale !== currentLocale) {
      setLocale(/** @type {any} */ (locale));
    }
    onClose();
  }
</script>

<BottomSheet
  {open}
  title={activeAccount ? displayName : m.mobile_menu_title()}
  {onClose}
  testid="mobile-menu-sheet"
>
  {#snippet header()}
    {#if activeAccount}
      <a
        href={resolve(profileLink(activeAccount.pubkey))}
        onclick={onClose}
        data-testid="sheet-identity"
        class="flex min-w-0 items-center gap-3 rounded-box py-1"
      >
        <ProfileAvatar pubkey={activeAccount.pubkey} size="md" fallbackType="robohash" />
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-base leading-tight font-semibold">{displayName}</span>
          {#if activeAccount.type === 'readonly' || displayName !== npubShort}
            <!-- Without a profile name the title already IS the short npub. -->
            <span class="truncate text-xs text-base-content/60">
              {#if activeAccount.type === 'readonly'}
                {m.auth_readonly_account_type()}{displayName !== npubShort ? ' · ' : ''}
              {/if}
              {#if displayName !== npubShort}{npubShort}{/if}
            </span>
          {/if}
        </span>
      </a>
    {:else}
      <h2 class="text-lg font-semibold">{m.mobile_menu_title()}</h2>
    {/if}
  {/snippet}

  {#if activeAccount}
    <!-- The three things people open this menu for. -->
    <div class="grid grid-cols-3 gap-2" data-testid="sheet-tiles">
      <a
        href={resolve(profileLink(activeAccount.pubkey))}
        onclick={onClose}
        data-testid="tile-profile"
        class="tile"
      >
        <PersonIcon class_="w-6 h-6 text-primary" />
        {m.common_profile()}
      </a>
      <a href={resolve('/settings')} onclick={onClose} data-testid="tile-settings" class="tile">
        <GearIcon class_="w-6 h-6 text-primary" />
        {m.common_settings()}
      </a>
      <button
        type="button"
        onclick={() => openOwnQrCode(activeAccount?.pubkey, onClose)}
        data-testid="tile-qr"
        class="tile"
      >
        <QrCodeIcon class_="w-6 h-6 text-primary" />
        {m.navbar_qr_code()}
      </button>
    </div>

    <ul class="menu mt-3 w-full p-0">
      <!-- What the dock owns but hides behind chat composers, plus Kalender. -->
      <li>
        <a href={resolve('/c/inbox')} onclick={onClose} data-testid="menu-inbox">
          <BellIcon class_="w-5 h-5" />
          <span class="flex-1">{m.dashboard_nav_inbox()}</span>
          {#if getTotalUnreadCount() > 0}
            <span class="badge badge-sm badge-primary">{getTotalUnreadCount()}</span>
          {/if}
        </a>
      </li>
      <li>
        <a href={resolve('/c/messages')} onclick={onClose} data-testid="menu-messages">
          <MessageSquareIcon class_="w-5 h-5" />
          <span class="flex-1">{m.dm_title()}</span>
          {#if getUnreadDmCount() > 0}
            <span class="badge badge-sm badge-primary">{getUnreadDmCount()}</span>
          {/if}
        </a>
      </li>
      <li>
        <a href={resolve('/c/') + '?view=my-stuff'} onclick={onClose} data-testid="menu-my-stuff">
          <FilesIcon class_="w-5 h-5" />
          {m.dashboard_nav_my_stuff()}
        </a>
      </li>
      <li>
        <a
          href={resolve('/calendar')}
          onclick={onClose}
          onfocus={prefetchCalendarData}
          data-testid="menu-calendar"
        >
          <CalendarIcon class_="w-5 h-5" />
          {m.navbar_calendar()}
        </a>
      </li>

      <li class="menu-disabled"><hr class="my-1 border-base-300" /></li>

      <!-- Account plumbing -->
      {#if isMembershipAdmin}
        <li>
          <a href={resolve('/admin/membership')} onclick={onClose}>
            <CheckIcon class_="w-5 h-5" />
            <span class="flex-1">{m.admin_membership_title()}</span>
            {#if pendingMembershipCount() > 0}
              <span class="badge badge-sm badge-primary" data-testid="membership-pending-badge">
                {pendingMembershipCount()}
              </span>
            {/if}
          </a>
        </li>
      {/if}
      <li>
        <button type="button" onclick={openLoginModal}>
          <ArrowLeftRightIcon class_="w-5 h-5" />
          <span class="flex-1">{m.navbar_switch_account()}</span>
          {#if accountCount > 1}
            <span class="badge badge-ghost badge-sm" data-testid="account-count-badge">
              {accountCount}
            </span>
          {/if}
        </button>
      </li>

      <li class="menu-disabled"><hr class="my-1 border-base-300" /></li>

      {#if helpLink}
        <li>
          <a {...helpLink} onclick={onClose} data-testid="help-menu-item">
            <QuestionCircleIcon class_="w-5 h-5" />
            {m.navbar_help()}
          </a>
        </li>
      {/if}
      <li>
        <button type="button" onclick={openReportIssue} data-testid="report-issue-menu-item">
          <ChatTextIcon class_="w-5 h-5" />
          {m.report_issue_menu_item()}
        </button>
      </li>
    </ul>
  {:else}
    <ul class="menu w-full p-0">
      <li>
        <a href={resolve('/discover')} onclick={onClose}>
          <SearchIcon class_="w-5 h-5" />
          {m.navbar_discover()}
        </a>
      </li>
      <li>
        <a href={resolve('/communities')} onclick={onClose}>
          <PeopleIcon class_="w-5 h-5" />
          {m.navbar_communities()}
        </a>
      </li>
      <li>
        <a href={resolve('/calendar')} onclick={onClose} onfocus={prefetchCalendarData}>
          <CalendarIcon class_="w-5 h-5" />
          {m.navbar_calendar()}
        </a>
      </li>
      {#if helpLink}
        <li class="menu-disabled"><hr class="my-1 border-base-300" /></li>
        <li>
          <a {...helpLink} onclick={onClose} data-testid="help-menu-item">
            <QuestionCircleIcon class_="w-5 h-5" />
            {m.navbar_help()}
          </a>
        </li>
      {/if}
    </ul>
  {/if}

  <!-- Quiet rows: language, connection, legal. -->
  <div class="mt-1 border-t border-base-300 pt-2">
    <div class="flex items-center justify-between px-3 py-1.5 text-sm text-base-content/70">
      <span>{m.navbar_language()}</span>
      <div class="join" role="group" aria-label={m.navbar_language()}>
        {#each locales as locale (locale)}
          <button
            type="button"
            class="btn join-item btn-sm {currentLocale === locale ? 'btn-primary' : 'btn-ghost'}"
            aria-pressed={currentLocale === locale}
            data-testid="language-{locale}"
            onclick={() => handleLanguageChange(locale)}
          >
            {languageNames[locale] || locale}
          </button>
        {/each}
      </div>
    </div>
    <ul class="menu w-full menu-sm p-0 text-sm text-base-content/70">
      <ConnectionStatus variant="menu-item" {onClose} />
      <li>
        <div class="gap-1">
          <InfoCircleIcon class_="w-4 h-4" />
          <a href={resolve('/imprint')} onclick={onClose} data-testid="imprint-menu-item"
            >{m.navbar_imprint()}</a
          >
          {#if runtimeConfig.privacy?.enabled}
            <span aria-hidden="true">·</span>
            <a href={resolve('/privacy')} onclick={onClose} data-testid="privacy-menu-item"
              >{m.navbar_privacy()}</a
            >
          {/if}
        </div>
      </li>
    </ul>
  </div>

  {#if activeAccount}
    <ul class="menu mt-1 w-full border-t border-base-300 p-0 pt-2">
      <li>
        <button
          type="button"
          class="text-error"
          onclick={() => logoutCurrent(activeAccount, onClose)}
          data-testid="sheet-logout"
        >
          {m.navbar_logout_current()}
        </button>
      </li>
      {#if accountCount > 1}
        <li>
          <button
            type="button"
            class="text-error"
            onclick={() => logoutAll(activeAccount?.pubkey, onClose)}
          >
            {m.navbar_logout_all()}
          </button>
        </li>
      {/if}
    </ul>
  {:else}
    <button
      type="button"
      class="btn mt-3 btn-block btn-primary"
      data-testid="sheet-login"
      onclick={openLoginModal}
    >
      {m.common_login()}
    </button>
  {/if}
</BottomSheet>

<style>
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
    padding: 0.75rem 0.25rem;
    border-radius: var(--radius-box, 1rem);
    background: var(--color-base-200);
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1.1;
    text-align: center;
    color: var(--color-base-content);
  }
  .tile:hover,
  .tile:focus-visible {
    background: var(--color-base-300);
  }
</style>
