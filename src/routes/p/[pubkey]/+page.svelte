<script>
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { ProfileModel } from 'applesauce-core/models';
  import { getProfilePointersFromList } from 'applesauce-common/helpers';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { addressLoader } from '$lib/loaders/base.js';
  import { profileLoader } from '$lib/loaders/profile.js';
  import { getProfileLookupRelays, getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { getWriteRelays } from '$lib/services/relay-service.svelte.js';
  import { contactsStore } from '$lib/stores/contacts.svelte.js';
  import { actionRunner } from '$lib/stores/action-runner.svelte.js';
  import { FollowUser, UnfollowUser } from 'applesauce-actions/actions';
  import { useActiveUser } from '$lib/stores/accounts.svelte.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { showToast } from '$lib/helpers/toast';
  import { useProfileBadges } from '$lib/stores/badge-awards.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useNip05Status } from '$lib/stores/nip05-status.svelte.js';
  import { getProfileNip05s } from '$lib/helpers/nip05-verify.js';
  import {
    parseEdufeedProfile,
    resolveProfileInterests
  } from '$lib/helpers/educational/educatorProfile.js';
  import { useProfileContent } from '$lib/stores/profile-content.svelte.js';
  import { PROFILE_TABS_D_TAG, parseProfileTabsEvent } from '$lib/helpers/profile-tabs.js';
  import { saveProfileTabs } from '$lib/services/profile-tabs-service.js';
  import { pinnedPointersFromEvent } from '$lib/helpers/profile-feed.js';
  import ProfileTabEditor from '$lib/components/profile/ProfileTabEditor.svelte';
  import ImpersonationWarning from '$lib/components/profile/ImpersonationWarning.svelte';
  import ProfileHeader from '$lib/components/profile/ProfileHeader.svelte';
  import ProfileRail from '$lib/components/profile/ProfileRail.svelte';
  import ProfileTabBar from '$lib/components/profile/ProfileTabBar.svelte';
  import ProfileContentTab from '$lib/components/profile/ProfileContentTab.svelte';
  import ProfileFeedView from '$lib/components/profile/ProfileFeedView.svelte';
  import CommunikeyCard from '$lib/components/CommunikeyCard.svelte';
  import BadgeCard from '$lib/components/badges/BadgeCard.svelte';
  import { PeopleIcon, BadgeIcon, UserIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {import('./$types').PageProps} */
  let { data } = $props();

  let profile = $state(/** @type {any} */ (null));
  let profileEvent = $state(/** @type {any} */ (null));
  let activeTab = $state('posts');
  let activatedTabs = new SvelteSet(['posts']);
  let loadingState = $state(/** @type {'loading' | 'found' | 'notFound'} */ ('loading'));
  let timeoutId = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  let followLoading = $state(false);
  let editingTabs = $state(false);

  // Communities tab state
  let communityPubkeys = $state(/** @type {string[]} */ ([]));
  let communitiesLoading = $state(true);

  // Kind 10015 interests list (authoritative for interests; legacy kind-0
  // edufeed.interests is the fallback via resolveProfileInterests).
  let interestsListEvent = $state(/** @type {any} */ (null));

  // Kind 10001 pin list (NIP-51 pinned posts)
  let pinListEvent = $state(/** @type {any} */ (null));

  // Kind 30078 tab configuration (owner-defined order + hidden tabs)
  let tabsConfigEvent = $state(/** @type {any} */ (null));
  // Draft while the owner is editing; committed on "Fertig".
  let draftOrder = $state(/** @type {string[]} */ ([]));
  let draftHidden = $state(/** @type {string[]} */ ([]));
  let savingTabs = $state(false);

  // Accepted badges (NIP-58 profile_badges)
  const profileBadges = useProfileBadges(() => data.pubkey);
  const getBadges = profileBadges.getBadges;
  const getIssuerProfiles = useProfileMap(() => getBadges().map((b) => b.issuerPubkey));

  const getActiveUser = useActiveUser();
  let activeUser = $derived(getActiveUser());
  let isOwnProfile = $derived(activeUser?.pubkey === data.pubkey);
  let isFollowing = $derived(contactsStore.contacts.includes(data.pubkey));

  // All NIP-05 addresses: content nip05 first, then repeated nip05 event tags.
  // Falls back to the parsed content while the raw kind 0 hasn't arrived yet.
  const nip05s = $derived.by(() => {
    const list = getProfileNip05s(profileEvent);
    if (list.length === 0 && profile?.nip05) return [profile.nip05];
    return list;
  });

  const getNip05Status = useNip05Status(
    () => data.pubkey,
    () => nip05s
  );

  // Profile loader + model
  $effect(() => {
    profile = null;
    profileEvent = null;
    loadingState = 'loading';

    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    timeoutId = setTimeout(() => {
      if (!profile && !profileEvent) {
        loadingState = 'notFound';
      }
    }, 5000);

    const loaderSub = profileLoader({
      kind: 0,
      pubkey: data.pubkey,
      relays: untrack(() => getProfileLookupRelays())
    }).subscribe((event) => {
      if (event) {
        profileEvent = event;
        loadingState = 'found';
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      }
    });

    const modelSub = eventStore.model(ProfileModel, data.pubkey).subscribe((profileContent) => {
      if (profileContent) {
        profile = profileContent;
        loadingState = 'found';
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      }
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
  });

  // Communities loader (kind 30000 follow set with d="communities")
  $effect(() => {
    communityPubkeys = [];
    communitiesLoading = true;

    const relays = untrack(() => getAllLookupRelays());
    const loaderSub = addressLoader({
      kind: 30000,
      pubkey: data.pubkey,
      identifier: 'communities',
      relays
    }).subscribe();

    const modelSub = eventStore
      .replaceable(30000, data.pubkey, 'communities')
      .subscribe((event) => {
        if (event) {
          const pointers = getProfilePointersFromList(event);
          communityPubkeys = pointers.map((p) => p.pubkey);
        }
        communitiesLoading = false;
      });

    // Also check user's write relays
    /** @type {import('rxjs').Subscription | undefined} */
    let writeRelaySub;
    getWriteRelays(data.pubkey).then((writeRelays) => {
      const newRelays = writeRelays.filter((r) => !relays.includes(r));
      if (newRelays.length > 0) {
        writeRelaySub = addressLoader({
          kind: 30000,
          pubkey: data.pubkey,
          identifier: 'communities',
          relays: newRelays
        }).subscribe();
      }
    });

    // Set timeout for communities loading
    const commTimer = setTimeout(() => {
      communitiesLoading = false;
    }, 4000);

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
      writeRelaySub?.unsubscribe();
      clearTimeout(commTimer);
    };
  });

  // Pin list loader (kind 10001)
  $effect(() => {
    const targetPubkey = data.pubkey;
    pinListEvent = null;

    const loaderSub = addressLoader({
      kind: 10001,
      pubkey: targetPubkey,
      relays: untrack(() => getAllLookupRelays())
    }).subscribe();

    const modelSub = eventStore.replaceable(10001, targetPubkey).subscribe((event) => {
      pinListEvent = event || null;
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  // Tab configuration loader (kind 30078, d="edufeed:profile-tabs")
  $effect(() => {
    const targetPubkey = data.pubkey;
    tabsConfigEvent = null;

    const loaderSub = addressLoader({
      kind: 30078,
      pubkey: targetPubkey,
      identifier: PROFILE_TABS_D_TAG,
      relays: untrack(() => getAllLookupRelays())
    }).subscribe();

    const modelSub = eventStore
      .replaceable(30078, targetPubkey, PROFILE_TABS_D_TAG)
      .subscribe((event) => {
        tabsConfigEvent = event || null;
      });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  // Interests list loader (kind 10015)
  $effect(() => {
    const targetPubkey = data.pubkey;
    interestsListEvent = null;

    const loaderSub = addressLoader({
      kind: 10015,
      pubkey: targetPubkey,
      relays: untrack(() => getAllLookupRelays())
    }).subscribe();

    const modelSub = eventStore.replaceable(10015, targetPubkey).subscribe((event) => {
      interestsListEvent = event || null;
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  /** @param {string} tab */
  function switchTab(tab) {
    activeTab = tab;
    activatedTabs.add(tab);
  }

  async function handleFollow() {
    if (!activeUser || followLoading) return;
    followLoading = true;
    try {
      if (isFollowing) {
        await actionRunner.run(UnfollowUser, data.pubkey);
        showToast(m.profile_unfollow_success(), 'success');
      } else {
        await actionRunner.run(FollowUser, data.pubkey);
        showToast(m.profile_follow_success(), 'success');
      }
    } catch (err) {
      console.error('Follow action failed:', err);
      showToast(m.profile_follow_error(), 'error');
    } finally {
      followLoading = false;
    }
  }

  function openEditModal() {
    modalStore.openModal('profile', {
      profile: profile,
      pubkey: data.pubkey
    });
  }

  let edufeedValue = $derived({
    ...parseEdufeedProfile(profile),
    interests: resolveProfileInterests(interestsListEvent, profile)
  });

  // Page-level content loading: one loader set + progressive counts for all tabs.
  const profileContent = useProfileContent(() => data.pubkey);
  let contentCounts = $derived(profileContent.getCounts());

  /** @type {Record<string, number>} */
  let tabCounts = $derived({
    ...contentCounts,
    communities: communityPubkeys.length,
    badges: getBadges().length
  });

  let railCounts = $derived({
    posts: tabCounts.posts,
    content: tabCounts.content,
    communities: tabCounts.communities,
    badges: tabCounts.badges
  });

  /** @type {Record<string, () => string>} */
  const TAB_LABELS = {
    posts: m.profile_tab_posts,
    content: m.profile_tab_content,
    articles: m.profile_tab_articles,
    events: m.profile_tab_events,
    polls: m.profile_tab_polls,
    bookmarks: m.profile_tab_bookmarks,
    communities: m.profile_tab_communities,
    badges: m.profile_tab_badges
  };

  /** Tab ids rendered by ProfileContentTab (model-only panels)
   * @type {Array<'content' | 'articles' | 'events' | 'polls' | 'bookmarks'>} */
  const CONTENT_TAB_IDS = ['content', 'articles', 'events', 'polls', 'bookmarks'];

  // Owner-defined order + hidden tabs (kind 30078), applied for all viewers.
  let tabsConfig = $derived(parseProfileTabsEvent(tabsConfigEvent));

  let visibleTabs = $derived(
    tabsConfig.order
      .filter((id) => !tabsConfig.hidden.includes(id))
      .map((id) => ({
        id,
        label: TAB_LABELS[id](),
        count: tabCounts[id] || 0
      }))
  );

  // If the active tab got hidden (config arrived or owner hid it), fall back
  // to the first visible tab.
  $effect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.some((t) => t.id === activeTab)) {
      switchTab(visibleTabs[0].id);
    }
  });

  let editorTabs = $derived(
    draftOrder.map((id) => ({ id, label: TAB_LABELS[id](), count: tabCounts[id] || 0 }))
  );

  async function toggleTabEditing() {
    if (savingTabs) return;
    if (!editingTabs) {
      draftOrder = [...tabsConfig.order];
      draftHidden = [...tabsConfig.hidden];
      editingTabs = true;
      return;
    }
    // "Fertig" — persist only when the draft differs from the stored config.
    const dirty =
      draftOrder.join(',') !== tabsConfig.order.join(',') ||
      [...draftHidden].sort().join(',') !== [...tabsConfig.hidden].sort().join(',');
    if (dirty) {
      savingTabs = true;
      try {
        await saveProfileTabs(draftOrder, draftHidden);
      } catch (err) {
        console.error('Failed to save tab config:', err);
        showToast(m.profile_tabs_save_error(), 'error');
      } finally {
        savingTabs = false;
      }
    }
    editingTabs = false;
  }
</script>

{#if loadingState === 'loading'}
  <div class="flex min-h-full items-center justify-center bg-base-200">
    <div class="text-center">
      <span class="loading loading-lg loading-spinner text-primary"></span>
      <p class="mt-4 text-base-content/60">{m.profile_loading()}</p>
    </div>
  </div>
{:else if loadingState === 'notFound' && isOwnProfile}
  <!-- Own profile not found — CTA to create -->
  <div class="flex min-h-full items-center justify-center bg-base-200 px-4">
    <div class="w-full max-w-md rounded-2xl bg-base-100 p-8 text-center shadow-2xl">
      <div class="mb-6">
        <div
          class="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-primary/10"
        >
          <UserIcon class_="w-12 h-12 text-primary" />
        </div>
        <h2 class="mb-2 text-2xl font-bold text-base-content">{m.profile_not_found_title()}</h2>
        <p class="mb-6 text-base-content/60">
          {m.profile_not_found_own_description()}
        </p>
      </div>

      <button onclick={openEditModal} class="btn w-full shadow-lg btn-lg btn-primary">
        {m.profile_create_button()}
      </button>

      <div class="mt-4 rounded-lg bg-info/10 p-4 text-left">
        <p class="text-sm text-base-content/70">
          <span class="font-semibold">{m.profile_what_happens_next()}</span><br />
          {m.profile_publish_info()}
        </p>
      </div>
    </div>
  </div>
{:else if loadingState === 'notFound' && !isOwnProfile}
  <!-- Other user's profile not found -->
  <div class="flex min-h-full items-center justify-center bg-base-200 px-4">
    <div class="max-w-md text-center">
      <div class="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-base-300">
        <UserIcon class_="w-12 h-12 text-base-content/40" />
      </div>
      <h2 class="mb-3 text-3xl font-bold text-base-content">{m.profile_not_found_title()}</h2>
      <p class="mb-4 text-lg text-base-content/60">{m.profile_not_found_other_description()}</p>
      <div class="rounded-lg bg-base-300 p-4">
        <p class="text-sm text-base-content/50">
          {m.profile_not_found_relay_info()}
        </p>
      </div>
    </div>
  </div>
{:else if profile}
  <div class="pf-profile">
    <ProfileHeader
      pubkey={data.pubkey}
      npub={data.npub || ''}
      {profile}
      {profileEvent}
      {nip05s}
      nip05Status={getNip05Status()}
      {isOwnProfile}
      {activeUser}
      {isFollowing}
      {followLoading}
      postsCount={tabCounts.posts}
      editing={editingTabs}
      onFollow={handleFollow}
      onToggleEdit={toggleTabEditing}
      onEditProfile={openEditModal}
    />

    {#if getNip05Status() === 'unverified' && (profile?.name || profile?.display_name)}
      <ImpersonationWarning
        pubkey={data.pubkey}
        npub={data.npub || ''}
        profileName={profile?.name || profile?.display_name}
      />
    {/if}

    {#if isOwnProfile && editingTabs}
      <ProfileTabEditor
        tabs={editorTabs}
        order={draftOrder}
        hidden={draftHidden}
        onChange={(order, hidden) => {
          draftOrder = order;
          draftHidden = hidden;
        }}
      />
    {:else}
      <ProfileTabBar tabs={visibleTabs} {activeTab} onSelect={switchTab} />
    {/if}

    <div class="pf-body">
      <div class="pf-main">
        <!-- Posts (mixed feed with filter chips) -->
        <div class:hidden={activeTab !== 'posts'}>
          {#if activatedTabs.has('posts')}
            <ProfileFeedView
              pubkeys={[data.pubkey]}
              {activeUser}
              externalLoaders
              showFilters={false}
              pinnedPointers={pinnedPointersFromEvent(pinListEvent)}
              canPin={isOwnProfile}
            />
          {/if}
        </div>

        <!-- Per-type content tabs (model-only panels) -->
        {#each CONTENT_TAB_IDS as tabId (tabId)}
          <div class:hidden={activeTab !== tabId}>
            {#if activatedTabs.has(tabId)}
              <ProfileContentTab
                pubkey={data.pubkey}
                {tabId}
                pinnedPointers={pinnedPointersFromEvent(pinListEvent)}
                canPin={isOwnProfile}
              />
            {/if}
          </div>
        {/each}

        <!-- Communities -->
        <div class:hidden={activeTab !== 'communities'}>
          {#if activatedTabs.has('communities')}
            <div class="py-4">
              {#if communitiesLoading}
                <div class="flex flex-col items-center justify-center py-16">
                  <span class="loading loading-lg loading-spinner text-primary"></span>
                  <p class="mt-4 text-base-content/60">{m.profile_content_loading()}</p>
                </div>
              {:else if communityPubkeys.length === 0}
                <div class="pf-empty">
                  <PeopleIcon class_="w-10 h-10" />
                  <h3>{m.profile_communities_empty_title()}</h3>
                  <p>{m.profile_communities_empty_description()}</p>
                </div>
              {:else}
                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {#each communityPubkeys as pubkey (pubkey)}
                    <CommunikeyCard {pubkey} />
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Badges -->
        <div class:hidden={activeTab !== 'badges'}>
          {#if activatedTabs.has('badges')}
            <div class="py-4">
              {#if profileBadges.isLoading}
                <div class="flex flex-col items-center justify-center py-16">
                  <span class="loading loading-lg loading-spinner text-primary"></span>
                  <p class="mt-4 text-base-content/60">{m.profile_content_loading()}</p>
                </div>
              {:else if getBadges().length === 0}
                <div class="pf-empty">
                  <BadgeIcon class_="w-10 h-10" />
                  <h3>{m.profile_badges_empty_title()}</h3>
                  <p>{m.profile_badges_empty_description()}</p>
                </div>
              {:else}
                {@const issuerProfiles = getIssuerProfiles()}
                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {#each getBadges() as badge (badge.id)}
                    <BadgeCard
                      {badge}
                      issuerProfile={issuerProfiles.get(badge.issuerPubkey) || null}
                    />
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <ProfileRail
        pubkey={data.pubkey}
        npub={data.npub || ''}
        {profile}
        {profileEvent}
        {edufeedValue}
        {communityPubkeys}
        badges={getBadges()}
        {isOwnProfile}
        counts={railCounts}
        onEditProfile={openEditModal}
        onShowCommunities={() => switchTab('communities')}
        onShowBadges={() => switchTab('badges')}
      />
    </div>
  </div>
{/if}

<style>
  /* ── Redesigned profile page ──────────────────────────────────────────
     Styled entirely against the global editorial aliases (--c-*, defined in
     src/app.css on :root from the active DaisyUI theme) — the page follows
     whichever theme a deployment ships. Child components (header, tab bar,
     rail, panels) inherit the custom properties through the DOM. */
  .pf-profile {
    --pf-display: var(--font-display);
    --pad: clamp(20px, 4vw, 72px);

    min-height: 100%;
    /* The layout's <main> is a flex column with a fixed height; without this
       the page gets flex-shrunk to the viewport and the background is cut
       off while the content overflows. */
    flex-shrink: 0;
    background: var(--c-bg);
    color: var(--c-ink);
  }

  /* ── body grid: main column + right rail ── */
  .pf-body {
    max-width: 1180px;
    margin: 0 auto;
    padding: 26px var(--pad) 80px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 326px;
    gap: 34px;
    align-items: start;
  }
  .pf-main {
    min-width: 0;
  }

  /* Mobile: single column, rail renders below the content (source order). */
  @media (max-width: 940px) {
    .pf-body {
      grid-template-columns: 1fr;
    }
  }

  .pf-empty {
    background: var(--c-paper);
    border: 1.5px dashed var(--c-rule);
    border-radius: 14px;
    padding: 40px 24px;
    text-align: center;
    color: var(--c-ink-soft);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .pf-empty h3 {
    font-family: var(--pf-display);
    font-weight: 700;
    font-size: 16px;
    color: var(--c-ink);
    margin: 0;
  }
  .pf-empty p {
    margin: 0;
    font-size: 14px;
    max-width: 420px;
  }
</style>
