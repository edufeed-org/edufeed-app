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
  import {
    CheckIcon,
    AlertIcon,
    CopyIcon,
    EditIcon,
    GearIcon,
    LightningIcon,
    MessageSquareIcon,
    PlusIcon
  } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

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
   *   editing: boolean,
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
    editing,
    onFollow,
    onToggleEdit,
    onEditProfile
  } = $props();

  let bannerError = $state(false);
  let copied = $state(false);

  let bannerUrl = $derived(profile?.banner || null);
  let displayName = $derived(profile?.name || profile?.display_name || 'Anonymous User');
  let npubShort = $derived(npub ? `${npub.slice(0, 12)}…${npub.slice(-6)}` : '');

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
    <div class="pf-avatar">
      <img
        src={profile?.picture || `https://robohash.org/${pubkey}`}
        alt={displayName}
        onerror={(e) => {
          const img = /** @type {HTMLImageElement} */ (e.currentTarget);
          if (!img.src.includes('robohash.org')) img.src = `https://robohash.org/${pubkey}`;
        }}
      />
    </div>

    <div class="pf-identity">
      <h1>
        {displayName}
        {#if nip05Status === 'verified'}
          <span class="pf-chip verified" data-testid="profile-verified-chip">
            <CheckIcon class_="w-3 h-3" />
            {m.profile_verified_chip()}
          </span>
        {:else if nip05Status === 'unverified'}
          <span class="pf-chip unverified" data-testid="profile-unverified-chip">
            <AlertIcon class_="w-3 h-3" />
            {m.profile_unverified_chip()}
          </span>
        {/if}
      </h1>

      {#if nip05Status === 'verified' && nip05s.length > 0}
        <div class="pf-nip05s">
          {#each nip05s as nip05 (nip05)}
            <Nip05VerifiedBadge {pubkey} {nip05} />
          {/each}
        </div>
      {/if}

      <div class="pf-npub-pill" data-testid="npub-pill">
        {npubShort}
        <button onclick={copyNpub} title={m.profile_copy_pubkey()}>
          {#if copied}
            <CheckIcon class_="w-3.5 h-3.5 text-success" />
          {:else}
            <CopyIcon class_="w-3.5 h-3.5" />
          {/if}
        </button>
      </div>

      {#if postsCount > 0}
        <div class="pf-quick">
          <span data-testid="stat-posts"><b>{postsCount}</b> {m.profile_stat_posts()}</span>
        </div>
      {/if}
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
          <ul class="dropdown-content menu z-40 w-56 rounded-box bg-base-100 p-2 shadow-lg">
            <li>
              <button data-testid="edit-profile" onclick={onEditProfile}>
                <EditIcon class_="w-4 h-4" />
                {m.profile_edit_modal_title()}
              </button>
            </li>
          </ul>
        </div>
      {:else if activeUser}
        <WaveButton {profileEvent} pubkey={activeUser.pubkey} />
        <button
          class="pf-btn solid"
          class:following={isFollowing}
          data-testid="follow-button"
          disabled={followLoading}
          onclick={onFollow}
        >
          {#if followLoading}
            <span class="loading loading-xs loading-spinner"></span>
          {:else if isFollowing}
            <CheckIcon class_="w-4 h-4" />
            {m.profile_unfollow_button()}
          {:else}
            <PlusIcon class_="w-4 h-4" />
            {m.profile_follow_button()}
          {/if}
        </button>
        <a
          href={resolve(`/c/messages?to=${pubkey}`)}
          class="pf-btn ghost"
          aria-label={m.dm_title()}
        >
          <MessageSquareIcon class_="w-4 h-4" />
          {m.profile_message_button()}
        </a>
        {#if profile?.lud16}
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external: lightning wallet -->
          <a
            href={`lightning:${profile.lud16}`}
            class="pf-btn ghost icon zap"
            title={m.profile_zap_button()}
            data-testid="zap-link"
          >
            <LightningIcon class_="w-4 h-4" />
          </a>
        {/if}
      {/if}
    </div>
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
      radial-gradient(circle at 18% 30%, #fff 0 1.4px, transparent 2.4px) 0 0/24px 24px,
      radial-gradient(circle at 60% 80%, #fff 0 1.4px, transparent 2.4px) 0 0/24px 24px;
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
  .pf-avatar {
    width: 116px;
    height: 116px;
    border-radius: 999px;
    flex-shrink: 0;
    align-self: flex-start;
    margin-top: -74px;
    overflow: hidden;
    background: linear-gradient(150deg, var(--c-hero), oklch(56% 0.13 290));
    border: 5px solid var(--c-bg);
    box-shadow: 0 16px 34px -16px rgba(0, 0, 0, 0.45);
  }
  .pf-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .pf-identity {
    flex: 1;
    min-width: 0;
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
    color: #fff;
    padding: 5px 10px;
    border-radius: 999px;
  }
  .pf-chip.verified {
    background: var(--color-primary);
    color: var(--color-primary-content);
  }
  .pf-chip.unverified {
    background: var(--color-warning);
    color: var(--color-warning-content);
  }

  .pf-nip05s {
    margin-top: 9px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 14px;
    font-size: 14px;
    color: var(--c-ink-soft);
  }

  .pf-npub-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-top: 11px;
    font-family: ui-monospace, 'JetBrains Mono', monospace;
    font-size: 12px;
    line-height: 1;
    color: var(--c-ink-soft);
    background: var(--c-paper);
    border: 1px solid var(--c-rule);
    border-radius: 999px;
    padding: 6px 8px 6px 12px;
    white-space: nowrap;
  }
  .pf-npub-pill button {
    border: 0;
    background: transparent;
    width: 24px;
    height: 24px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    cursor: pointer;
    color: var(--c-ink-soft);
  }
  .pf-npub-pill button:hover {
    background: var(--c-bg);
    color: var(--c-ink);
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

  /* ── action buttons ── */
  .pf-btns {
    display: flex;
    gap: 9px;
    padding-bottom: 6px;
    align-items: center;
    flex-wrap: wrap;
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
  .pf-btn.zap:hover {
    color: var(--c-cta);
    box-shadow: inset 0 0 0 1.5px var(--c-cta);
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
    }
  }
</style>
