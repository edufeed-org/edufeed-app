<!--
  ProfileRail — right-hand column of the redesigned profile page: About card
  (bio + educator context), at-a-glance stats, community mini-list, badge
  strip and connections (website / zap / developer details). Design tokens
  are inherited from the page's .pf-profile root.
-->
<script>
  import { resolve } from '$app/paths';
  import { appSettings } from '$lib/stores/app-settings.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import BadgeThumb from '$lib/components/badges/BadgeThumb.svelte';
  import EducatorContextDisplay from '$lib/components/shared/EducatorContextDisplay.svelte';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';
  import {
    PeopleIcon,
    BadgeIcon,
    LinkIcon,
    Link45Icon,
    LightningIcon,
    LocationIcon,
    EditIcon,
    ChevronRightIcon,
    UserIcon
  } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   pubkey: string,
   *   npub: string,
   *   profile: any,
   *   profileEvent: any,
   *   edufeedValue: any,
   *   communityPubkeys: string[],
   *   badges: any[],
   *   isOwnProfile: boolean,
   *   counts: Record<string, number>,
   *   onEditProfile: () => void,
   *   onShowCommunities: () => void,
   *   onShowBadges: () => void
   * }}
   */
  let {
    pubkey,
    npub,
    profile,
    profileEvent,
    edufeedValue,
    communityPubkeys,
    badges,
    isOwnProfile,
    counts,
    onEditProfile,
    onShowCommunities,
    onShowBadges
  } = $props();

  const MINI_COMMUNITIES = 4;

  let miniCommunities = $derived(communityPubkeys.slice(0, MINI_COMMUNITIES));
  const getCommunityProfiles = useProfileMap(() => miniCommunities);

  /** @param {string} communityPubkey */
  function communityName(communityPubkey) {
    const p = getCommunityProfiles().get(communityPubkey);
    return p?.name || p?.display_name || `${communityPubkey.slice(0, 8)}…`;
  }

  /** @param {string} communityPubkey */
  function communityPicture(communityPubkey) {
    return getCommunityProfiles().get(communityPubkey)?.picture || null;
  }

  // Hide the About card entirely when there's nothing to say (visitors only —
  // the owner keeps it as the entry point to profile editing).
  let hasAboutContent = $derived(
    Boolean(
      profile?.about ||
        profile?.location ||
        edufeedValue?.interests?.length ||
        edufeedValue?.educationalLevels?.length ||
        edufeedValue?.subjects?.length
    )
  );

  let statEntries = $derived(
    [
      { label: m.profile_stat_posts(), value: counts.posts },
      { label: m.profile_tab_content(), value: counts.content },
      { label: m.profile_tab_communities(), value: counts.communities },
      { label: m.profile_tab_badges(), value: counts.badges }
    ].filter((s) => s.value > 0)
  );
</script>

<aside class="pf-rail">
  <!-- Über -->
  {#if hasAboutContent || isOwnProfile}
    <div class="pf-rcard">
      <h4>
        <UserIcon class_="w-3.5 h-3.5" />
        {m.profile_about_title()}
        {#if isOwnProfile}
          <button
            class="pf-rcard-edit"
            data-testid="edit-profile-rail"
            title={m.profile_edit_modal_title()}
            onclick={onEditProfile}
          >
            <EditIcon class_="w-3.5 h-3.5" />
          </button>
        {/if}
      </h4>
      {#if profile?.about}
        <p class="pf-about">{profile.about}</p>
      {/if}
      {#if profile?.location}
        <div class="pf-meta-row">
          <LocationIcon class_="w-4 h-4" />
          {profile.location}
        </div>
      {/if}
      <EducatorContextDisplay value={edufeedValue} />
    </div>
  {/if}

  <!-- Auf einen Blick -->
  {#if statEntries.length > 0}
    <div class="pf-rcard">
      <h4>{m.profile_stats_title()}</h4>
      <div class="pf-stats">
        {#each statEntries as stat (stat.label)}
          <div class="s">
            <div class="n">{stat.value}</div>
            <div class="l">{stat.label}</div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Communities -->
  {#if communityPubkeys.length > 0}
    <div class="pf-rcard">
      <h4>
        <PeopleIcon class_="w-3.5 h-3.5" />
        {m.profile_tab_communities()}
        <button class="pf-rcard-cnt" onclick={onShowCommunities}>{communityPubkeys.length}</button>
      </h4>
      <div class="pf-mini-comm">
        {#each miniCommunities as communityPubkey (communityPubkey)}
          <a href={resolve(`/c/${communityPubkey}`)}>
            {#if communityPicture(communityPubkey)}
              <img class="ic" src={communityPicture(communityPubkey)} alt="" />
            {:else}
              <span class="ic fallback">{communityName(communityPubkey)[0]?.toUpperCase()}</span>
            {/if}
            <span class="nm">{communityName(communityPubkey)}</span>
            <span class="go"><ChevronRightIcon class_="w-4 h-4" /></span>
          </a>
        {/each}
      </div>
      {#if communityPubkeys.length > MINI_COMMUNITIES}
        <button class="pf-view-all" data-testid="rail-communities-all" onclick={onShowCommunities}>
          {m.profile_rail_view_all()} ({communityPubkeys.length})
          <ChevronRightIcon class_="w-3.5 h-3.5" />
        </button>
      {/if}
    </div>
  {/if}

  <!-- Abzeichen -->
  {#if badges.length > 0}
    <div class="pf-rcard">
      <h4>
        <BadgeIcon class_="w-3.5 h-3.5" />
        {m.profile_rail_badges_title()}
        <button class="pf-rcard-cnt" onclick={onShowBadges}>{badges.length}</button>
      </h4>
      <div class="pf-badge-strip">
        {#each badges as badge (badge.id)}
          <button class="b" title={badge.badgeName || 'Badge'} onclick={onShowBadges}>
            <BadgeThumb
              thumb={badge.badgeThumb}
              image={badge.badgeImage}
              alt={badge.badgeName || 'Badge'}
              class="h-10 w-10 rounded-xl"
            />
          </button>
        {/each}
      </div>
      <button class="pf-view-all" data-testid="rail-badges-all" onclick={onShowBadges}>
        {m.profile_rail_view_all()} ({badges.length})
        <ChevronRightIcon class_="w-3.5 h-3.5" />
      </button>
    </div>
  {/if}

  <!-- Verbindungen -->
  {#if profile?.website || profile?.lud16 || appSettings.debugMode}
    <div class="pf-rcard">
      <h4>
        <LinkIcon class_="w-3.5 h-3.5" />
        {m.profile_connections_title()}
      </h4>
      {#if profile?.website}
        <!-- eslint-disable svelte/no-navigation-without-resolve -- external: user website -->
        <a class="pf-rlink" href={profile.website} target="_blank" rel="noopener noreferrer">
          <span class="ic"><Link45Icon class_="w-4 h-4" /></span>
          {m.profile_website_label()}
          <code>{profile.website.replace(/^https?:\/\//, '')}</code>
        </a>
        <!-- eslint-enable svelte/no-navigation-without-resolve -->
      {/if}
      {#if profile?.lud16}
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external: lightning wallet -->
        <a class="pf-rlink" href={`lightning:${profile.lud16}`}>
          <span class="ic"><LightningIcon class_="w-4 h-4" /></span>
          {m.profile_zap_label()}
          <code>{profile.lud16}</code>
        </a>
      {/if}

      {#if appSettings.debugMode}
        <details class="pf-dev">
          <summary>{m.profile_dev_details()}</summary>
          <div class="pf-dev-body">
            <div class="row">
              <span>{m.profile_npub_label()}</span>
              <code>{npub || 'N/A'}</code>
            </div>
            <div class="row">
              <span>{m.profile_hex_pubkey_label()}</span>
              <code>{pubkey}</code>
            </div>
            {#if profileEvent?.created_at}
              <div class="row">
                <span>{m.profile_updated_label()}</span>
                <span>{formatCalendarDate(new Date(profileEvent.created_at * 1000), 'short')}</span>
              </div>
            {/if}
            <pre>{JSON.stringify(profileEvent || {}, null, 2)}</pre>
          </div>
        </details>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .pf-rail {
    display: flex;
    flex-direction: column;
    gap: 16px;
    position: sticky;
    top: 74px;
  }
  .pf-rcard {
    background: var(--c-paper);
    border: 1px solid var(--c-rule);
    border-radius: 18px;
    padding: 20px 22px;
  }
  .pf-rcard h4 {
    font-family: var(--pf-display);
    font-weight: 700;
    font-size: 11px;
    line-height: 1;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--c-ink-soft);
    margin: 0 0 14px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .pf-rcard-edit,
  .pf-rcard-cnt {
    margin-left: auto;
    border: 0;
    background: transparent;
    color: var(--c-ink-soft);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    padding: 2px;
  }
  .pf-rcard-cnt {
    font-family: ui-monospace, 'JetBrains Mono', monospace;
    font-size: 11px;
    font-weight: 600;
  }
  .pf-rcard-edit:hover,
  .pf-rcard-cnt:hover {
    color: var(--c-ink);
  }

  .pf-about {
    font-size: 14.5px;
    line-height: 1.6;
    color: var(--c-ink);
    margin: 0 0 12px;
    white-space: pre-line;
  }
  .pf-meta-row {
    display: flex;
    align-items: center;
    gap: 9px;
    font-family: var(--pf-display);
    font-size: 13.5px;
    color: var(--c-ink-soft);
    margin-top: 6px;
  }

  .pf-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .pf-stats .n {
    font-family: var(--pf-display);
    font-weight: 800;
    font-size: 25px;
    line-height: 1;
    color: var(--c-ink);
    letter-spacing: -0.02em;
  }
  .pf-stats .l {
    font-family: var(--pf-display);
    font-size: 12px;
    color: var(--c-ink-soft);
    margin-top: 3px;
  }

  .pf-mini-comm {
    display: flex;
    flex-direction: column;
  }
  .pf-mini-comm a {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 9px 0;
    text-decoration: none;
    color: inherit;
  }
  .pf-mini-comm a + a {
    border-top: 1px solid var(--c-rule);
  }
  .pf-mini-comm .ic {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    flex-shrink: 0;
    object-fit: cover;
  }
  .pf-mini-comm .ic.fallback {
    display: grid;
    place-items: center;
    color: var(--c-on-dark);
    background: linear-gradient(150deg, var(--c-hero), var(--c-hero-2));
    font-family: var(--pf-display);
    font-weight: 800;
    font-size: 14px;
  }
  .pf-mini-comm .nm {
    font-family: var(--pf-display);
    font-weight: 600;
    font-size: 14px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pf-mini-comm .go {
    margin-left: auto;
    color: var(--c-ink-soft);
    display: inline-flex;
  }

  .pf-badge-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 9px;
  }
  .pf-badge-strip .b {
    border: 0;
    background: transparent;
    padding: 0;
    cursor: pointer;
    transition: transform 0.12s;
  }
  .pf-badge-strip .b:hover {
    transform: translateY(-2px) scale(1.05);
  }

  .pf-view-all {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 10px;
    padding: 8px 0 0;
    width: 100%;
    border: 0;
    border-top: 1px solid var(--c-rule);
    background: transparent;
    font-family: var(--pf-display);
    font-weight: 600;
    font-size: 12.5px;
    color: var(--c-ink-soft);
    cursor: pointer;
  }
  .pf-view-all:hover {
    color: var(--c-ink);
  }

  .pf-rlink {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 0;
    font-family: var(--pf-display);
    font-weight: 500;
    font-size: 14px;
    color: var(--c-ink);
    text-decoration: none;
  }
  .pf-rlink + .pf-rlink {
    border-top: 1px solid var(--c-rule);
  }
  .pf-rlink .ic {
    color: var(--c-olive-2);
    flex-shrink: 0;
    display: inline-flex;
  }
  .pf-rlink code {
    margin-left: auto;
    font-family: ui-monospace, 'JetBrains Mono', monospace;
    font-size: 11px;
    color: var(--c-ink-soft);
    word-break: break-all;
    text-align: right;
  }

  .pf-dev {
    margin-top: 8px;
    border-top: 1px solid var(--c-rule);
    padding-top: 10px;
  }
  .pf-dev summary {
    cursor: pointer;
    font-family: var(--pf-display);
    font-size: 12px;
    color: var(--c-ink-soft);
  }
  .pf-dev summary:hover {
    color: var(--c-ink);
  }
  .pf-dev-body {
    margin-top: 10px;
    font-size: 12px;
    color: var(--c-ink-soft);
  }
  .pf-dev-body .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    padding: 3px 0;
  }
  .pf-dev-body code {
    font-family: ui-monospace, 'JetBrains Mono', monospace;
    font-size: 10.5px;
    word-break: break-all;
    text-align: right;
  }
  .pf-dev-body pre {
    margin-top: 10px;
    max-height: 320px;
    overflow: auto;
    background: var(--c-bg);
    border-radius: 10px;
    padding: 10px;
    font-size: 10.5px;
    white-space: pre-wrap;
  }

  @media (max-width: 940px) {
    .pf-rail {
      position: static;
    }
  }
</style>
