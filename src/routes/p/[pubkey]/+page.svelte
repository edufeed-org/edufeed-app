<script>
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { ProfileModel } from 'applesauce-core/models';
  import { getProfilePointersFromList, getNip10References } from 'applesauce-common/helpers';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { addressLoader } from '$lib/loaders/base.js';
  import { profileLoader } from '$lib/loaders/profile.js';
  import {
    getProfileLookupRelays,
    getCalendarRelays,
    getEducationalRelays,
    getArticleRelays,
    getAllLookupRelays
  } from '$lib/helpers/relay-helper.js';
  import { getWriteRelays } from '$lib/services/relay-service.svelte.js';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';
  import { getCalendarEventMetadata } from '$lib/helpers/eventUtils.js';
  import { formatAMBResource } from '$lib/helpers/educational/index.js';
  import { filterSocialBookmarks, groupByUrl, groupByEventRef } from '$lib/helpers/urlGrouping.js';
  import { contactsStore } from '$lib/stores/contacts.svelte.js';
  import { actionRunner } from '$lib/stores/action-runner.svelte.js';
  import { FollowUser, UnfollowUser } from 'applesauce-actions/actions';
  import { useActiveUser } from '$lib/stores/accounts.svelte.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { showToast } from '$lib/helpers/toast';
  import { useBadgeAwards } from '$lib/stores/badge-awards.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import NoteCard from '$lib/components/notes/NoteCard.svelte';
  import ProfileContentView from '$lib/components/profile/ProfileContentView.svelte';
  import CalendarEventCard from '$lib/components/calendar/CalendarEventCard.svelte';
  import AMBResourceCard from '$lib/components/educational/AMBResourceCard.svelte';
  import ArticleCard from '$lib/components/article/ArticleCard.svelte';
  import CommunikeyCard from '$lib/components/CommunikeyCard.svelte';
  import UrlCard from '$lib/components/bookmarks/UrlCard.svelte';
  import EventHighlightCard from '$lib/components/bookmarks/EventHighlightCard.svelte';
  import BadgeCard from '$lib/components/badges/BadgeCard.svelte';
  import BadgeHeaderRow from '$lib/components/badges/BadgeHeaderRow.svelte';
  import WaveButton from '$lib/components/waves/WaveButton.svelte';
  import {
    CopyIcon,
    ChevronDownIcon,
    GlobeIcon,
    LightningIcon,
    CheckIcon,
    CalendarIcon,
    GraduationCapIcon,
    BookIcon,
    PeopleIcon,
    BookmarkIcon,
    BadgeIcon,
    ChatIcon,
    UserIcon
  } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {import('./$types').PageProps} */
  let { data } = $props();

  let profile = $state(/** @type {any} */ (null));
  let profileEvent = $state(/** @type {any} */ (null));
  let showRawData = $state(false);
  let activeTab = $state('notes');
  let activatedTabs = new SvelteSet(['notes']);
  let bannerError = $state(false);
  let loadingState = $state(/** @type {'loading' | 'found' | 'notFound'} */ ('loading'));
  let timeoutId = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  let copied = $state(false);
  let followLoading = $state(false);

  // Communities tab state
  let communityPubkeys = $state(/** @type {string[]} */ ([]));
  let communitiesLoading = $state(true);

  // Badge awards
  const badgeAwards = useBadgeAwards(() => data.pubkey);
  const getBadges = badgeAwards.getBadges;
  const getIssuerProfiles = useProfileMap(() => getBadges().map((b) => b.issuerPubkey));

  const getActiveUser = useActiveUser();
  let activeUser = $derived(getActiveUser());
  let isOwnProfile = $derived(activeUser?.pubkey === data.pubkey);
  let isFollowing = $derived(contactsStore.contacts.includes(data.pubkey));

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

  function handleBannerError() {
    bannerError = true;
  }

  /** @param {any} profile */
  function getBannerUrl(profile) {
    return profile?.banner || null;
  }

  /** @param {string} text */
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  /** @param {string} pubkey */
  function formatPubkey(pubkey) {
    return `${pubkey.slice(0, 16)}...${pubkey.slice(-8)}`;
  }

  let bannerUrl = $derived(getBannerUrl(profile));

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

  /** @type {{ id: string, label: () => string, icon: any }[]} */
  const tabs = [
    { id: 'notes', label: () => m.profile_tab_notes(), icon: ChatIcon },
    { id: 'calendar', label: () => m.profile_tab_calendar(), icon: CalendarIcon },
    { id: 'resources', label: () => m.profile_tab_resources(), icon: GraduationCapIcon },
    { id: 'articles', label: () => m.profile_tab_articles(), icon: BookIcon },
    { id: 'communities', label: () => m.profile_tab_communities(), icon: PeopleIcon },
    { id: 'badges', label: () => m.profile_tab_badges(), icon: BadgeIcon },
    { id: 'bookmarks', label: () => m.profile_tab_bookmarks(), icon: BookmarkIcon }
  ];
</script>

{#if loadingState === 'loading'}
  <div class="flex min-h-screen items-center justify-center bg-base-200">
    <div class="text-center">
      <span class="loading loading-lg loading-spinner text-primary"></span>
      <p class="mt-4 text-base-content/60">{m.profile_loading()}</p>
    </div>
  </div>
{:else if loadingState === 'notFound' && isOwnProfile}
  <!-- Own profile not found — CTA to create -->
  <div class="flex min-h-screen items-center justify-center bg-base-200 px-4">
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
  <div class="flex min-h-screen items-center justify-center bg-base-200 px-4">
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
  <div class="min-h-screen bg-base-200">
    <!-- Banner -->
    <div class="relative">
      {#if bannerUrl && !bannerError}
        <div
          class="relative h-48 bg-cover bg-center md:h-64"
          style="background-image: url('{bannerUrl}')"
        >
          <img src={bannerUrl} alt="Banner" class="hidden" onerror={() => handleBannerError()} />
        </div>
      {:else}
        <div class="h-48 bg-gradient-to-r from-primary/30 to-secondary/30 md:h-64"></div>
      {/if}

      <!-- Profile content overlapping banner -->
      <div class="relative px-4 pb-6">
        <div class="mx-auto max-w-4xl">
          <!-- Avatar + action buttons row -->
          <div class="flex items-end justify-between">
            <div
              class="-mt-16 h-32 w-32 overflow-hidden rounded-full border-4 border-base-100 bg-base-300"
            >
              <img
                src={profile?.picture || `https://robohash.org/${data.pubkey}`}
                alt={profile?.name || profile?.display_name || 'Profile'}
                class="h-full w-full object-cover"
              />
            </div>

            <div class="flex gap-2">
              {#if isOwnProfile}
                <button onclick={openEditModal} class="btn btn-outline btn-sm">
                  {m.common_edit()}
                </button>
              {:else if activeUser}
                <WaveButton {profileEvent} pubkey={activeUser.pubkey} />
                <button
                  onclick={handleFollow}
                  disabled={followLoading}
                  class="btn btn-sm {isFollowing ? 'btn-outline' : 'btn-primary'}"
                >
                  {#if followLoading}
                    <span class="loading loading-xs loading-spinner"></span>
                  {:else if isFollowing}
                    {m.profile_unfollow_button()}
                  {:else}
                    {m.profile_follow_button()}
                  {/if}
                </button>
              {/if}
            </div>
          </div>

          <!-- Name + info -->
          <div class="mt-4">
            <h1 class="text-2xl font-bold text-base-content">
              {profile?.name || profile?.display_name || 'Anonymous User'}
            </h1>

            {#if profile?.display_name && profile.display_name !== profile?.name}
              <p class="text-base-content/60">@{profile.display_name}</p>
            {/if}

            <!-- Contact info -->
            <div class="mt-3 flex flex-wrap items-center gap-4 text-sm">
              {#if profile?.nip05}
                <div class="flex items-center gap-1 text-primary">
                  <CheckIcon class_="w-4 h-4" />
                  <span>{profile.nip05}</span>
                </div>
              {/if}

              {#if profile?.website}
                <div class="flex items-center gap-1 text-base-content/60">
                  <GlobeIcon class_="w-4 h-4" />
                  <!-- eslint-disable svelte/no-navigation-without-resolve -- external: user website -->
                  <a
                    href={profile.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="hover:text-primary"
                  >
                    {profile.website}
                  </a>
                  <!-- eslint-enable svelte/no-navigation-without-resolve -->
                </div>
              {/if}

              {#if profile?.lud16}
                <div class="flex items-center gap-1 text-warning">
                  <LightningIcon class_="w-4 h-4" />
                  <span>{profile.lud16}</span>
                </div>
              {/if}
            </div>

            <!-- Public key -->
            <div class="mt-3 flex items-center gap-2">
              <code class="rounded bg-base-300 px-3 py-1 font-mono text-sm text-base-content/70">
                {data.npub
                  ? `${data.npub.slice(0, 16)}...${data.npub.slice(-8)}`
                  : formatPubkey(data.pubkey)}
              </code>
              <button
                onclick={() => copyToClipboard(data.npub || data.pubkey)}
                class="btn btn-ghost btn-xs"
                title={m.profile_copy_pubkey()}
              >
                {#if copied}
                  <CheckIcon class_="w-4 h-4 text-success" />
                {:else}
                  <CopyIcon class_="w-4 h-4" />
                {/if}
              </button>
            </div>

            <!-- Bio -->
            {#if profile?.about}
              <p class="mt-4 max-w-2xl leading-relaxed text-base-content/80">{profile.about}</p>
            {/if}

            <!-- Badge header row -->
            {#if getBadges().length > 0}
              <BadgeHeaderRow badges={getBadges()} onViewAll={() => switchTab('badges')} />
            {/if}
          </div>
        </div>
      </div>
    </div>

    <!-- Tabs + Content -->
    <div class="mx-auto max-w-4xl">
      <!-- Tab navigation -->
      <div class="scrollbar-none overflow-x-auto border-b border-base-300">
        <div role="tablist" class="tabs-bordered tabs flex-nowrap">
          {#each tabs as tab (tab.id)}
            {@const Icon = tab.icon}
            <button
              role="tab"
              class="tab gap-2 whitespace-nowrap {activeTab === tab.id ? 'tab-active' : ''}"
              onclick={() => switchTab(tab.id)}
            >
              <Icon class_="w-4 h-4" />
              {tab.label()}
            </button>
          {/each}
        </div>
      </div>

      <!-- Tab content -->
      <div class="px-4 pb-8">
        <!-- Notes -->
        <div class:hidden={activeTab !== 'notes'}>
          {#if activatedTabs.has('notes')}
            <ProfileContentView
              pubkey={data.pubkey}
              kinds={[1]}
              getRelays={getProfileLookupRelays}
              emptyTitle={m.profile_notes_empty_title()}
              emptyDescription={m.profile_notes_empty_description()}
              emptyIconPath="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            >
              {#snippet content(items, authorProfiles)}
                {@const rootNotes = items.filter((item) => {
                  const refs = getNip10References(item);
                  return !refs?.reply?.e && !refs?.root?.e;
                })}
                <div class="space-y-3">
                  {#each rootNotes as note (note.id)}
                    <NoteCard
                      {note}
                      authorProfile={authorProfiles.get(note.pubkey) || null}
                      {activeUser}
                      extraRelays={getProfileLookupRelays()}
                    />
                  {/each}
                </div>
              {/snippet}
            </ProfileContentView>
          {/if}
        </div>

        <!-- Calendar -->
        <div class:hidden={activeTab !== 'calendar'}>
          {#if activatedTabs.has('calendar')}
            <ProfileContentView
              pubkey={data.pubkey}
              kinds={[31922, 31923]}
              getRelays={getCalendarRelays}
              emptyTitle={m.profile_calendar_empty_title()}
              emptyDescription={m.profile_calendar_empty_description()}
              emptyIconPath="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            >
              {#snippet content(items, _authorProfiles)}
                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {#each items as rawEvent (rawEvent.id)}
                    {@const event = getCalendarEventMetadata(rawEvent)}
                    {#if event}
                      <CalendarEventCard {event} compact={true} />
                    {/if}
                  {/each}
                </div>
              {/snippet}
            </ProfileContentView>
          {/if}
        </div>

        <!-- Resources -->
        <div class:hidden={activeTab !== 'resources'}>
          {#if activatedTabs.has('resources')}
            <ProfileContentView
              pubkey={data.pubkey}
              kinds={[30142]}
              getRelays={getEducationalRelays}
              emptyTitle={m.profile_resources_empty_title()}
              emptyDescription={m.profile_resources_empty_description()}
              emptyIconPath="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222"
            >
              {#snippet content(items, authorProfiles)}
                <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {#each items as rawEvent (rawEvent.id)}
                    {@const resource = formatAMBResource(rawEvent)}
                    {#if resource}
                      <AMBResourceCard
                        {resource}
                        authorProfile={authorProfiles.get(rawEvent.pubkey) || null}
                        compact={false}
                      />
                    {/if}
                  {/each}
                </div>
              {/snippet}
            </ProfileContentView>
          {/if}
        </div>

        <!-- Articles -->
        <div class:hidden={activeTab !== 'articles'}>
          {#if activatedTabs.has('articles')}
            <ProfileContentView
              pubkey={data.pubkey}
              kinds={[30023]}
              getRelays={getArticleRelays}
              emptyTitle={m.profile_articles_empty_title()}
              emptyDescription={m.profile_articles_empty_description()}
              emptyIconPath="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            >
              {#snippet content(items, authorProfiles)}
                <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {#each items as article (article.id)}
                    <ArticleCard
                      {article}
                      authorProfile={authorProfiles.get(article.pubkey) || null}
                      compact={false}
                    />
                  {/each}
                </div>
              {/snippet}
            </ProfileContentView>
          {/if}
        </div>

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
                <div class="flex flex-col items-center justify-center py-16 text-center">
                  <div
                    class="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-base-200"
                  >
                    <PeopleIcon class_="w-12 h-12 text-base-content/40" />
                  </div>
                  <h3 class="mb-2 text-lg font-semibold text-base-content">
                    {m.profile_communities_empty_title()}
                  </h3>
                  <p class="max-w-md text-base-content/60">
                    {m.profile_communities_empty_description()}
                  </p>
                </div>
              {:else}
                <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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
              {#if badgeAwards.isLoading}
                <div class="flex flex-col items-center justify-center py-16">
                  <span class="loading loading-lg loading-spinner text-primary"></span>
                  <p class="mt-4 text-base-content/60">{m.profile_content_loading()}</p>
                </div>
              {:else if getBadges().length === 0}
                <div class="flex flex-col items-center justify-center py-16 text-center">
                  <div
                    class="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-base-200"
                  >
                    <BadgeIcon class_="w-12 h-12 text-base-content/40" />
                  </div>
                  <h3 class="mb-2 text-lg font-semibold text-base-content">
                    {m.profile_badges_empty_title()}
                  </h3>
                  <p class="max-w-md text-base-content/60">
                    {m.profile_badges_empty_description()}
                  </p>
                </div>
              {:else}
                {@const issuerProfiles = getIssuerProfiles()}
                <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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

        <!-- Bookmarks -->
        <div class:hidden={activeTab !== 'bookmarks'}>
          {#if activatedTabs.has('bookmarks')}
            <ProfileContentView
              pubkey={data.pubkey}
              kinds={[39701, 9802, 1111]}
              getRelays={getAllLookupRelays}
              emptyTitle={m.profile_bookmarks_empty_title()}
              emptyDescription={m.profile_bookmarks_empty_description()}
              emptyIconPath="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
            >
              {#snippet content(items, authorProfiles)}
                {@const urlGroups = groupByUrl(filterSocialBookmarks(items))}
                {@const eventRefGroups = groupByEventRef(items)}
                {@const urlMap = new Map(urlGroups.map((g) => [g.url, g]))}
                {@const refMap = new Map(eventRefGroups.map((g) => [g.aTagValue, g]))}
                {@const sortedKeys = [
                  ...urlGroups.map((g) => ({ type: 'url', key: g.url, ts: g.latestActivity })),
                  ...eventRefGroups.map((g) => ({
                    type: 'ref',
                    key: g.aTagValue,
                    ts: g.latestActivity
                  }))
                ].toSorted((a, b) => b.ts - a.ts)}
                <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {#each sortedKeys as item (item.key)}
                    {#if item.type === 'url'}
                      {@const group = urlMap.get(item.key)}
                      {#if group}
                        <UrlCard {group} {authorProfiles} />
                      {/if}
                    {:else}
                      {@const group = refMap.get(item.key)}
                      {#if group}
                        <EventHighlightCard {group} {authorProfiles} />
                      {/if}
                    {/if}
                  {/each}
                </div>
              {/snippet}
            </ProfileContentView>
          {/if}
        </div>
      </div>

      <!-- Developer Section -->
      <div class="border-t border-base-300">
        <button
          class="flex w-full items-center justify-between px-6 py-4 text-left text-base-content/50 transition-colors hover:text-base-content/80"
          onclick={() => (showRawData = !showRawData)}
        >
          <span class="font-medium">{m.profile_developer_info()}</span>
          <ChevronDownIcon
            class_="w-5 h-5 transform transition-transform {showRawData ? 'rotate-180' : ''}"
          />
        </button>

        {#if showRawData}
          <div class="space-y-6 px-6 pb-6">
            <div class="rounded-lg bg-base-300 p-4">
              <h3 class="mb-4 text-lg font-medium text-base-content">{m.profile_basic_info()}</h3>
              <div class="space-y-3 text-sm">
                <div class="flex items-center justify-between">
                  <span class="text-base-content/50">{m.profile_npub_label()}</span>
                  <code
                    class="rounded bg-base-200 px-2 py-1 font-mono text-xs text-base-content/70"
                  >
                    {data.npub || 'N/A'}
                  </code>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-base-content/50">{m.profile_hex_pubkey_label()}</span>
                  <code
                    class="rounded bg-base-200 px-2 py-1 font-mono text-xs text-base-content/70"
                  >
                    {data.pubkey}
                  </code>
                </div>
                {#if profileEvent?.created_at}
                  <div class="flex items-center justify-between">
                    <span class="text-base-content/50">{m.profile_created_label()}</span>
                    <span class="text-base-content/70">
                      {formatCalendarDate(new Date(profileEvent.created_at * 1000), 'short')}
                    </span>
                  </div>
                {/if}
              </div>
            </div>

            <div class="rounded-lg bg-base-300 p-4">
              <h3 class="mb-4 text-lg font-medium text-base-content">{m.profile_raw_data()}</h3>
              <div class="max-h-96 overflow-y-auto rounded bg-base-200 p-4">
                <pre
                  class="font-mono text-xs whitespace-pre-wrap text-base-content/60">{JSON.stringify(
                    profile || {},
                    null,
                    2
                  )}</pre>
              </div>
            </div>

            <div class="rounded-lg bg-base-300 p-4">
              <h3 class="mb-4 text-lg font-medium text-base-content">{m.profile_raw_event()}</h3>
              <div class="max-h-96 overflow-y-auto rounded bg-base-200 p-4">
                <pre
                  class="font-mono text-xs whitespace-pre-wrap text-base-content/60">{JSON.stringify(
                    profileEvent || {},
                    null,
                    2
                  )}</pre>
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .scrollbar-none {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  .scrollbar-none::-webkit-scrollbar {
    display: none;
  }
</style>
