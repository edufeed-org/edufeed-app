<!--
  ProfileHeader — banner, avatar, identity block and action buttons of the
  redesigned profile page. Purely presentational: all data and actions come
  in via props; design tokens (--c-*, --pf-display, --pad) are inherited from
  the page's .pf-profile root.
-->
<script>
  import { resolve } from '$app/paths';
  import WaveButton from '$lib/components/waves/WaveButton.svelte';
  import Nip05VerifiedBadge from '$lib/components/shared/Nip05VerifiedBadge.svelte';
  import HoverCard from '$lib/components/shared/HoverCard.svelte';
  import Nip05InfoCard from '$lib/components/shared/Nip05InfoCard.svelte';
  import ProfileImageLicenses from '../shared/ProfileImageLicenses.svelte';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import {
    CheckIcon,
    AlertIcon,
    CopyIcon,
    EditIcon,
    GearIcon,
    LightningIcon,
    MessageSquareIcon,
    PeopleIcon,
    PlusIcon,
    QrCodeIcon,
    ChevronRightIcon,
    MoreIcon
  } from '$lib/components/icons';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { MediaQuery } from 'svelte/reactivity';
  import * as m from '$lib/paraglide/messages';
  import { getDisplayName } from '$lib/helpers/displayName.js';

  /**
   * @type {{
   *   pubkey: string,
   *   npub: string,
   *   profile: any,
   *   profileEvent: any,
   *   nip05s: string[],
   *   nip05Status: 'verified' | 'pending' | 'unverified',
   *   isOwnProfile: boolean,
   *   activeUser: any,
   *   isFollowing: boolean,
   *   followLoading: boolean,
   *   postsCount: number,
   *   followersCount?: number,
   *   followersCapped?: boolean,
   *   followingCount?: number,
   *   onShowPosts?: () => void,
   *   onShowFollowers?: () => void,
   *   onShowFollowing?: () => void,
   *   editing: boolean,
   *   isCommunity?: boolean,
   *   onFollow: () => void,
   *   onToggleEdit: () => void,
   *   onEditProfile: () => void
   * }}
   */
  let {
    pubkey,
    npub,
    profile,
    profileEvent,
    nip05s,
    nip05Status,
    isOwnProfile,
    activeUser,
    isFollowing,
    followLoading,
    postsCount,
    followersCount = 0,
    followersCapped = false,
    followingCount = 0,
    onShowPosts = undefined,
    onShowFollowers = () => {},
    onShowFollowing = () => {},
    editing,
    isCommunity = false,
    onFollow,
    onToggleEdit,
    onEditProfile
  } = $props();

  let bannerError = $state(false);
  let copied = $state(false);

  let bannerUrl = $derived(profile?.banner || null);
  let npubShort = $derived(npub ? `${npub.slice(0, 12)}…${npub.slice(-6)}` : '');
  // display_name first (NIP-24), then the handle, then the same short npub the
  // pill below shows — never a placeholder word, which reads as a real name to
  // anyone looking at the profile.
  let displayName = $derived(getDisplayName(profile) || npubShort);
  // A community is an npub, so its key also carries a plain kind 0 and lands
  // here like any person. The community page lives at /c/<npub> (hex 308s).
  let communityHref = $derived(resolve(`/c/${npub || pubkey}`));

  // Issue 9f7816e3: the profile as a QR code (and the scanner behind it).
  function showQr() {
    modalStore.openModal('profileQr', { pubkey, npub });
  }

  // Phone layout (the stylesheet's 780px breakpoint): the wave sits on the
  // avatar and the community link is a card; wider, the wave is a button in
  // the row and the community chip is the link. Guarded for jsdom/SSR.
  const narrowQuery =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? new MediaQuery('(max-width: 780px)')
      : null;
  const isNarrow = $derived(narrowQuery?.current ?? false);

  async function copyNpub() {
    try {
      await navigator.clipboard.writeText(npub || pubkey);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }
</script>

{#snippet identityItems()}
  <li>
    <button data-testid="show-qr" onclick={showQr}>
      <QrCodeIcon class_="w-4 h-4" />
      {m.profile_show_qr()}
    </button>
  </li>
  <li>
    <button data-testid="copy-npub" onclick={copyNpub}>
      {#if copied}
        <CheckIcon class_="w-4 h-4 text-success" />
      {:else}
        <CopyIcon class_="w-4 h-4" />
      {/if}
      <span class="flex min-w-0 flex-col items-start">
        <span>{m.profile_copy_pubkey()}</span>
        <span class="font-mono text-xs opacity-60">{npubShort}</span>
      </span>
    </button>
  </li>
{/snippet}

<!-- No banner set → the design's no-banner variant: avatar sits in flow with
     breathing room. The pattern gradient only backstops a failed image load. -->
{#if bannerUrl && !bannerError}
  <div class="pf-banner">
    <img src={bannerUrl} alt={m.profile_banner()} onerror={() => (bannerError = true)} />
  </div>
{:else if bannerUrl && bannerError}
  <div class="pf-banner pattern"></div>
{/if}

<div class="pf-head" class:no-banner={!bannerUrl}>
  <div class="pf-head-row">
    <div class="pf-avatar-wrap">
      <div class="pf-avatar">
        <ImageWithFallback
          src={profile?.picture || `https://robohash.org/${pubkey}`}
          alt={displayName}
          fallbackType="avatar"
          robohash={false}
          class="block h-full w-full object-cover"
        />
      </div>
      {#if isNarrow && !isOwnProfile && activeUser}
        <!-- Winken is a gesture at the person: on phones it sits on the avatar. -->
        <div class="pf-wave-avatar" data-testid="wave-avatar">
          <WaveButton {profileEvent} pubkey={activeUser.pubkey} />
        </div>
      {/if}
    </div>

    <div class="pf-identity">
      <h1>
        {displayName}
        {#if nip05Status === 'unverified'}
          <span class="pf-chip unverified" data-testid="profile-unverified-chip">
            <AlertIcon class_="w-3 h-3" />
            {m.profile_unverified_chip()}
          </span>
        {/if}
        {#if isCommunity && !isNarrow}
          <!-- The chip IS the way into the community (no extra button). -->
          <a class="pf-chip community" href={communityHref} data-testid="profile-community-chip">
            <PeopleIcon class_="w-3 h-3" />
            {m.profile_open_community_button()}
            <ChevronRightIcon class_="w-3 h-3" />
          </a>
        {/if}
      </h1>

      {#if nip05Status === 'verified' && nip05s.length > 0}
        <!-- The line explains itself (issue "Erklärung/Anleitung Verifizierung"):
             hover, tap or Enter opens the plain-language NIP-05 card. Fixed
             positioning escapes the header's overflow clipping. -->
        <HoverCard
          fixed
          position="bottom"
          enterDelay={100}
          class="relative inline-flex"
          triggerClass="contents"
        >
          {#snippet trigger()}
            <div class="pf-nip05s" data-testid="profile-nip05-line">
              {#each nip05s as nip05 (nip05)}
                <Nip05VerifiedBadge {pubkey} {nip05} />
              {/each}
            </div>
          {/snippet}
          {#snippet content()}
            <Nip05InfoCard nip05={nip05s[0] ?? null} />
          {/snippet}
        </HoverCard>
      {/if}

      {#if postsCount > 0 || followersCount > 0 || followingCount > 0}
        <div class="pf-quick">
          {#if postsCount > 0 && onShowPosts}
            <!-- Jumps to the tab the count refers to — the tabs below already
                 list the posts, so no modal like the follow stats. -->
            <button type="button" class="pf-stat" data-testid="stat-posts" onclick={onShowPosts}>
              <b>{postsCount}</b>
              {m.profile_stat_posts()}
            </button>
          {:else if postsCount > 0}
            <span data-testid="stat-posts"><b>{postsCount}</b> {m.profile_stat_posts()}</span>
          {/if}
          {#if followersCount > 0}
            <button
              type="button"
              class="pf-stat"
              data-testid="stat-followers"
              onclick={onShowFollowers}
            >
              <b>{followersCount}{followersCapped ? '+' : ''}</b>
              {m.profile_stat_followers()}
            </button>
          {/if}
          {#if followingCount > 0}
            <button
              type="button"
              class="pf-stat"
              data-testid="stat-following"
              onclick={onShowFollowing}
            >
              <b>{followingCount}</b>
              {m.profile_stat_following()}
            </button>
          {/if}
        </div>
      {/if}

      <!-- Picture/banner license attestations (issue 1ff3b524). Only shown when
           one resolves — see ProfileImageLicenses. -->
      <ProfileImageLicenses picture={profile?.picture} banner={profile?.banner} class="mt-2" />
    </div>

    <div class="pf-btns">
      {#if isOwnProfile}
        <button
          class="pf-btn solid"
          class:following={editing}
          data-testid="customize-tabs"
          onclick={onToggleEdit}
        >
          {#if editing}
            <CheckIcon class_="w-4 h-4" />
            {m.profile_customize_done()}
          {:else}
            <EditIcon class_="w-4 h-4" />
            {m.profile_customize_button()}
          {/if}
        </button>
        <div class="dropdown dropdown-end">
          <button class="pf-btn ghost icon" title={m.profile_more_button()} tabindex="0">
            <GearIcon class_="w-4 h-4" />
          </button>
          <ul
            class="dropdown-content menu z-40 w-64 rounded-box bg-base-100 p-2 shadow-lg"
            data-testid="profile-more-menu"
          >
            <li>
              <button data-testid="edit-profile" onclick={onEditProfile}>
                <EditIcon class_="w-4 h-4" />
                {m.profile_edit_modal_title()}
              </button>
            </li>
            {@render identityItems()}
          </ul>
        </div>
      {:else}
        {#if activeUser}
          <!-- Wide screens: four equal 46px squares (icons, names as tooltip
               + aria-label); phones: labelled Nachricht / Folgen. -->
          <a
            href={resolve(`/c/messages?to=${pubkey}`)}
            class="pf-btn"
            class:solid={isFollowing && isNarrow}
            class:ghost={!(isFollowing && isNarrow)}
            class:icon={!isNarrow}
            title={isNarrow ? undefined : m.profile_message_button()}
            aria-label={m.profile_message_button()}
          >
            <MessageSquareIcon class_="w-4 h-4" />
            {#if isNarrow}{m.profile_message_button()}{/if}
          </a>
          {#if !isNarrow}
            <span data-testid="wave-row" class="contents">
              <WaveButton {profileEvent} pubkey={activeUser.pubkey} variant="header" />
            </span>
          {/if}
          {#if isFollowing}
            <!-- Following reads as state; Entfolgen is rare and lives one tap down. -->
            <div class="dropdown dropdown-end">
              <button
                class="pf-btn ghost"
                class:icon={!isNarrow}
                data-testid="follow-button"
                tabindex="0"
                aria-haspopup="menu"
                aria-label={m.profile_following_button()}
                title={isNarrow ? undefined : m.profile_following_button()}
                disabled={followLoading}
              >
                {#if followLoading}
                  <span class="loading loading-xs loading-spinner"></span>
                {:else}
                  <CheckIcon class_="w-4 h-4" />
                {/if}
                {#if isNarrow}{m.profile_following_button()}{/if}
              </button>
              <ul class="dropdown-content menu z-40 w-48 rounded-box bg-base-100 p-2 shadow-lg">
                <li>
                  <button data-testid="unfollow-button" class="text-error" onclick={onFollow}>
                    {m.profile_unfollow_button()}
                  </button>
                </li>
              </ul>
            </div>
          {:else}
            <button
              class="pf-btn solid"
              class:icon={!isNarrow}
              data-testid="follow-button"
              aria-label={m.profile_follow_button()}
              title={isNarrow ? undefined : m.profile_follow_button()}
              disabled={followLoading}
              onclick={onFollow}
            >
              {#if followLoading}
                <span class="loading loading-xs loading-spinner"></span>
              {:else}
                <PlusIcon class_="w-4 h-4" />
              {/if}
              {#if isNarrow}{m.profile_follow_button()}{/if}
            </button>
          {/if}
        {/if}
        <div class="dropdown dropdown-end">
          <button
            class="pf-btn ghost icon"
            title={m.profile_more_button()}
            aria-label={m.profile_more_button()}
            data-testid="profile-more-button"
            tabindex="0"
          >
            <MoreIcon class_="w-4 h-4" />
          </button>
          <ul
            class="dropdown-content menu z-40 w-64 rounded-box bg-base-100 p-2 shadow-lg"
            data-testid="profile-more-menu"
          >
            {#if profile?.lud16}
              <li>
                <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external: lightning wallet -->
                <a href={`lightning:${profile.lud16}`} data-testid="zap-link">
                  <LightningIcon class_="w-4 h-4" />
                  {m.profile_zap_button()}
                </a>
              </li>
            {/if}
            {@render identityItems()}
          </ul>
        </div>
      {/if}
    </div>
    {#if isCommunity && isNarrow}
      <a class="pf-comcard" href={communityHref} data-testid="open-community-button">
        <span class="pf-comcard-ic"><PeopleIcon class_="w-5 h-5" /></span>
        <span class="pf-comcard-tx">
          <b>{m.profile_open_community_button()}</b>
          <span>{m.profile_open_community_hint()}</span>
        </span>
        <ChevronRightIcon class_="w-5 h-5 opacity-50" />
      </a>
    {/if}
  </div>
</div>

<style>
  /* ── banner ── */
  .pf-banner {
    position: relative;
    height: 172px;
    overflow: hidden;
    border-bottom: 1px solid var(--c-rule);
  }
  .pf-banner img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .pf-banner.pattern {
    background: linear-gradient(
      115deg,
      var(--c-hero) 0%,
      var(--c-hero-2) 48%,
      var(--c-olive-2) 100%
    );
  }
  .pf-banner.pattern::after {
    content: '';
    position: absolute;
    inset: 0;
    opacity: 0.18;
    background:
      radial-gradient(circle at 18% 30%, var(--c-on-dark) 0 1.4px, transparent 2.4px) 0 0/24px 24px,
      radial-gradient(circle at 60% 80%, var(--c-on-dark) 0 1.4px, transparent 2.4px) 0 0/24px 24px;
  }

  /* ── head row ── */
  .pf-head {
    max-width: 1180px;
    margin: 0 auto;
    padding: 0 var(--pad);
  }
  .pf-head-row {
    display: flex;
    gap: 22px;
    align-items: flex-end;
    position: relative;
    padding-top: 18px;
  }
  .pf-avatar-wrap {
    position: relative;
    flex-shrink: 0;
    align-self: flex-start;
  }
  .pf-wave-avatar {
    position: absolute;
    right: -4px;
    bottom: 4px;
  }
  .pf-avatar {
    width: 116px;
    height: 116px;
    border-radius: 999px;
    flex-shrink: 0;
    align-self: flex-start;
    margin-top: -74px;
    overflow: hidden;
    background: linear-gradient(150deg, var(--c-hero), var(--c-hero-2));
    border: 5px solid var(--c-bg);
    box-shadow: 0 16px 34px -16px rgba(0, 0, 0, 0.45);
  }
  .pf-identity {
    flex: 1;
    /* Floor instead of 0: with the community button the action row can grow
       to four buttons, which otherwise squeezes the identity column until the
       nowrap npub pill overflows into the buttons. Below the floor the
       button row wraps instead. */
    min-width: min(300px, 100%);
    padding-bottom: 4px;
  }
  .pf-identity h1 {
    font-family: var(--pf-display);
    font-weight: 800;
    font-size: clamp(26px, 3.2vw, 38px);
    line-height: 1.05;
    margin: 0;
    letter-spacing: -0.02em;
    color: var(--c-ink);
    display: flex;
    align-items: center;
    gap: 11px;
    flex-wrap: wrap;
  }
  .pf-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--pf-display);
    font-weight: 700;
    font-size: 11px;
    line-height: 1;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--c-on-dark);
    padding: 5px 10px;
    border-radius: 999px;
  }
  .pf-chip.verified {
    background: var(--color-primary);
    color: var(--color-primary-content);
    cursor: help;
  }
  .pf-chip.unverified {
    background: var(--color-warning);
    color: var(--color-warning-content);
  }
  .pf-chip.community {
    background: var(--color-accent);
    color: var(--color-accent-content);
    text-decoration: none;
  }
  .pf-chip.community:hover {
    background: color-mix(in oklch, var(--color-accent) 85%, var(--c-ink));
  }

  .pf-nip05s {
    cursor: help;
    margin-top: 9px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 14px;
    font-size: 14px;
    color: var(--c-ink-soft);
  }

  .pf-quick {
    display: flex;
    gap: 22px;
    margin-top: 14px;
    flex-wrap: wrap;
    font-family: var(--pf-display);
    font-size: 14px;
    color: var(--c-ink-soft);
  }
  .pf-quick b {
    color: var(--c-ink);
    font-weight: 700;
    font-size: 16px;
  }
  .pf-stat {
    color: inherit;
    cursor: pointer;
  }
  .pf-stat:hover,
  .pf-stat:focus-visible {
    text-decoration: underline;
  }

  /* ── action buttons ── */
  .pf-btns {
    display: flex;
    gap: 9px;
    padding-bottom: 6px;
    align-items: center;
    /* One row of four on wide screens: the group must not shrink or wrap
       below the identity column; phones wrap (media query below). */
    flex-shrink: 0;
    flex-wrap: nowrap;
  }
  .pf-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border-radius: 10px;
    padding: 12px 18px;
    font-family: var(--pf-display);
    font-weight: 700;
    font-size: 14px;
    cursor: pointer;
    border: 0;
    white-space: nowrap;
    text-decoration: none;
    transition:
      background 0.15s,
      box-shadow 0.15s;
  }
  .pf-btn.solid {
    background: var(--c-ink);
    color: var(--c-paper);
  }
  .pf-btn.solid:hover {
    background: color-mix(in oklch, var(--c-ink) 88%, var(--c-paper));
  }
  .pf-btn.solid.following {
    background: var(--c-paper);
    color: var(--c-ink);
    box-shadow: inset 0 0 0 1.5px var(--c-rule);
  }
  .pf-btn.ghost {
    background: var(--c-paper);
    color: var(--c-ink);
    box-shadow: inset 0 0 0 1.5px var(--c-rule);
  }
  .pf-btn.ghost:hover {
    background: var(--c-bg);
  }
  .pf-btn.icon {
    padding: 12px;
    width: 46px;
    justify-content: center;
  }
  .pf-comcard {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 10px;
    padding: 10px 12px;
    border-radius: 14px;
    background: var(--c-paper);
    box-shadow: inset 0 0 0 1px var(--c-rule);
    color: var(--c-ink);
    text-decoration: none;
  }
  .pf-comcard-ic {
    width: 38px;
    height: 38px;
    border-radius: 10px;
    background: var(--c-cta);
    color: var(--c-ink);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .pf-comcard-tx {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .pf-comcard-tx b {
    font-size: 14px;
  }
  .pf-comcard-tx span {
    font-size: 12px;
    color: var(--c-ink-soft);
  }

  /* No-banner variant: avatar in flow, header gets breathing room. */
  .pf-head.no-banner .pf-head-row {
    padding-top: 34px;
  }
  .pf-head.no-banner .pf-avatar {
    margin-top: 0;
  }

  @media (max-width: 780px) {
    .pf-head-row {
      flex-direction: column;
      align-items: flex-start;
      gap: 14px;
    }
    .pf-avatar {
      margin-top: -58px;
    }
    .pf-head.no-banner .pf-avatar {
      margin-top: 0;
    }
    .pf-btns {
      padding-bottom: 0;
      flex-wrap: wrap;
    }
  }
</style>
