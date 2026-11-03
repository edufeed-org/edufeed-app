<!--
  DashboardCommunitiesPhone — the phone "Communities" tab (below lg): one
  row per joined community, ordered by newest activity, "neu" when that
  activity is newer than this device's last visit, each row landing in the
  section the row-target rule picks (helpers/community-row-target.js);
  "Finden" on top, the create card below. Desktop keeps the card grid in
  DashboardCommunities.svelte.
-->

<script>
  /* eslint-disable svelte/prefer-svelte-reactivity -- Map replaced wholesale in $state.raw, never mutated reactively */
  import { resolve } from '$app/paths';
  import { getProfilePicture } from 'applesauce-core/helpers';
  import * as m from '$lib/paraglide/messages';
  import { useJoinedCommunitiesState } from '$lib/stores/joined-communities-list.svelte.js';
  import { useJoinedCommunityItems } from '$lib/stores/joined-community-items.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { readCommunityView } from '$lib/stores/community-last-view.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { isDiscoverTypeEnabled } from '$lib/helpers/discover-content-types.js';
  import { getCommunityTabs, kindToContentType } from '$lib/helpers/contentTypes.js';
  import {
    communityRowIsNew,
    communityRowTarget,
    newestCommunityItem
  } from '$lib/helpers/community-row-target.js';
  import { getFeedCardData } from '$lib/helpers/feedCardData.js';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import { hexToNpub } from '$lib/helpers/nostrUtils.js';
  import { sectionLabel } from '$lib/components/community/layout/section-labels.js';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import { SearchIcon, PlusIcon, ChevronRightIcon } from '$lib/components/icons';

  const joined = useJoinedCommunitiesState();
  let joinedCommunities = $derived(joined.list());
  let status = $derived(joined.status());

  const getItems = useJoinedCommunityItems(() => joinedCommunities);
  const getProfiles = useProfileMap(() => joinedCommunities);

  const canDiscoverCommunities = $derived(
    isDiscoverTypeEnabled('communities', runtimeConfig.discover?.contentTypes || [])
  );
  const findHref = $derived(
    canDiscoverCommunities ? resolve('/discover?type=communities') : resolve('/communities')
  );

  // Kind 10222 per community (the items hook's address loader fills the
  // store; this only reads it) — decides which sections a row may target.
  let communityEvents = $state.raw(/** @type {Map<string, any>} */ (new Map()));
  $effect(() => {
    const pubkeys = joinedCommunities;
    const next = new Map();
    const subs = pubkeys.map((pubkey) =>
      eventStore.replaceable(10222, pubkey).subscribe((event) => {
        next.set(pubkey, event ?? null);
        communityEvents = new Map(next);
      })
    );
    return () => subs.forEach((s) => s.unsubscribe());
  });

  /** @param {any} event */
  function itemTitle(event) {
    const data = /** @type {any} */ (getFeedCardData(event));
    const title = data?.title || data?.content || event?.content || '';
    return String(title).split('\n')[0].slice(0, 80);
  }

  let rows = $derived.by(() => {
    const now = Math.floor(Date.now() / 1000);
    const { perCommunity } = getItems();
    const profiles = getProfiles();
    const list = joinedCommunities.map((pubkey, index) => {
      const profile = profiles.get(pubkey);
      const newest = newestCommunityItem(perCommunity.get(pubkey) ?? []);
      const last = readCommunityView(pubkey, now);
      const lastVisit = last?.at ?? null;
      const tabs = getCommunityTabs(communityEvents.get(pubkey) ?? null);
      const target = communityRowTarget({
        newest,
        lastVisit,
        remembered: last?.view ?? null,
        tabs
      });
      const npub = hexToNpub(pubkey) ?? pubkey;
      const section = newest ? kindToContentType(newest.kind) : null;
      return {
        pubkey,
        index,
        name: profile?.display_name || profile?.name || npub.slice(0, 12),
        picture: getProfilePicture(profile) ?? null,
        newest,
        isNew: communityRowIsNew(newest, lastVisit),
        href: resolve(`/c/${npub}`) + (target === 'home' ? '' : `?view=${target}`),
        subtitle: newest
          ? [
              section ? sectionLabel(section) : null,
              itemTitle(newest),
              formatRelativeTime(newest.created_at)
            ]
              .filter(Boolean)
              .join(' · ')
          : profile?.about || ''
      };
    });
    return list.toSorted((a, b) => {
      if (a.newest && b.newest) return b.newest.created_at - a.newest.created_at;
      if (a.newest) return -1;
      if (b.newest) return 1;
      return a.index - b.index;
    });
  });
</script>

<section data-testid="communities-phone">
  <div class="mb-4 flex items-center gap-3">
    <h1 class="flex-1 text-2xl font-bold">{m.dashboard_communities_title()}</h1>
    <a href={findHref} data-testid="communities-find" class="btn btn-outline btn-sm">
      <SearchIcon class_="h-4 w-4" />
      {m.dashboard_communities_find()}
    </a>
  </div>

  {#if status === 'unavailable'}
    <div
      role="alert"
      data-testid="dashboard-communities-unavailable"
      class="mb-4 alert alert-warning"
    >
      <span class="text-sm">{m.dashboard_communities_unavailable()}</span>
      <button
        type="button"
        data-testid="dashboard-communities-retry"
        class="btn shrink-0 whitespace-nowrap btn-sm"
        onclick={() => joined.retry()}
      >
        {m.dashboard_communities_retry()}
      </button>
    </div>
  {:else if joinedCommunities.length === 0}
    <p class="mb-4 text-sm text-base-content/60">
      {status === 'loading' ? m.dashboard_communities_loading() : m.dashboard_communities_empty()}
    </p>
    {#if canDiscoverCommunities}
      <a
        href={resolve('/discover?type=communities')}
        data-testid="dashboard-communities-discover-card"
        class="mb-2 flex min-h-[60px] items-center gap-3 rounded-2xl bg-base-100 px-3.5 py-3"
      >
        <span class="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
          <SearchIcon class_="h-5 w-5" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block font-semibold">{m.dashboard_communities_discover()}</span>
          <span class="block text-xs text-base-content/60">
            {m.dashboard_communities_discover_subtitle()}
          </span>
        </span>
        <ChevronRightIcon class_="h-5 w-5 text-base-content/40" />
      </a>
    {/if}
  {/if}

  <ul class="flex flex-col gap-2">
    {#each rows as row (row.pubkey)}
      <li>
        <a
          href={row.href}
          data-testid="community-row-{row.pubkey}"
          class="flex min-h-[60px] items-center gap-3 rounded-2xl bg-base-100 px-3.5 py-3"
        >
          <span class="avatar">
            <span class="w-10 rounded-full">
              <ImageWithFallback
                src={row.picture}
                alt=""
                fallbackType="community"
                size="avatar_sm"
                class="h-full w-full rounded-full object-cover"
              />
            </span>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-semibold">{row.name}</span>
            {#if row.subtitle}
              <span class="block truncate text-xs text-base-content/60">{row.subtitle}</span>
            {/if}
          </span>
          {#if row.isNew}
            <span
              data-testid="community-row-new-{row.pubkey}"
              class="badge badge-sm badge-secondary">{m.dashboard_communities_row_new()}</span
            >
          {:else}
            <ChevronRightIcon class_="h-5 w-5 shrink-0 text-base-content/40" />
          {/if}
        </a>
      </li>
    {/each}
  </ul>

  <button
    type="button"
    data-testid="communities-phone-create"
    onclick={() => modalStore.openModal('createCommunity')}
    class="mt-3 flex min-h-[60px] w-full items-center gap-3 rounded-2xl border-2 border-dashed border-base-300 bg-base-100 px-3.5 py-3 text-left"
  >
    <span class="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
      <PlusIcon class_="h-5 w-5" />
    </span>
    <span class="min-w-0 flex-1">
      <span class="block font-semibold">{m.dashboard_communities_create()}</span>
      <span class="block text-xs text-base-content/60"
        >{m.dashboard_communities_create_subtitle()}</span
      >
    </span>
  </button>
</section>
