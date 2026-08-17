<script>
  import { resolve } from '$app/paths';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte';
  import { hexToNpub } from '$lib/helpers/nostrUtils';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  // Directly from the concord submodule, never the $lib/concord barrel —
  // convention every Concord call site follows (see CLAUDE.md's Concord
  // section) so this stays SSR-clean (Sidebar renders on every route,
  // including SSR ones).
  import {
    useUnlinkedConcordAreas,
    useConcordListLocked
  } from '$lib/concord/unlinked-areas.svelte.js';
  import { getConcordState, unlockConcordLists } from '$lib/concord/client.svelte.js';
  // NIP-29 groups the user belongs to that no followed community shows as a
  // channel — the same idea as the unlinked Concord areas below, one section
  // further down (laoc 2026-08-06: "wie vorher die Concord Gruppen").
  import { useUnlinkedGroups } from '$lib/groups/unlinked-groups.svelte.js';
  import { groupHref } from '$lib/groups/groups.js';
  import { areaUnreadState } from '$lib/concord/notifications.svelte.js';
  import { LockOpenIcon } from '$lib/components/icons';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import ConcordAreaBadge from '$lib/components/shared/ConcordAreaBadge.svelte';
  import ConcordUnreadDot from '$lib/components/shared/ConcordUnreadDot.svelte';
  import { showToast } from '$lib/helpers/toast.js';
  import * as m from '$lib/paraglide/messages';

  const activeUser = useActiveUser();
  const getJoinedCommunities = useJoinedCommunitiesList(); // gets the getter function
  const joinedCommunities = $derived(getJoinedCommunities()); // reactive value

  const getUnlinkedAreas = useUnlinkedConcordAreas();
  const unlinkedAreas = $derived(getUnlinkedAreas());

  const getUnlinkedGroups = useUnlinkedGroups();
  const unlinkedGroupRows = $derived(getUnlinkedGroups());

  // "Sync private areas" affordance (Fix 2): with autoUnlock:false the
  // Community List (kind 13302) stays encrypted after initial sync — with
  // no unlock action anywhere, a remote-only membership (e.g. one created on
  // another CORD client, only visible once Fix 1's stock relays sync the
  // list) never hydrates. Shown even when unlinkedAreas is currently empty —
  // that's exactly the locked-list case.
  const getListLocked = useConcordListLocked();
  const listLocked = $derived(getListLocked());
  const concordReady = $derived(getConcordState().phase === 'ready');
  // Read via getConcordState() (reactive $state.raw), not a raw module
  // variable — see client.svelte.js's comment on why signerHasNip44 must be
  // sourced this way (a template read of a plain variable never re-evaluates
  // after the async client finishes setup).
  const signerHasNip44 = $derived(!!getConcordState().client?.signer?.nip44);
  const unlocking = $derived(getConcordState().unlocking);
  // Aligns with CommunitySidebar's showUnlockAffordance (Fix 5, gating
  // asymmetry): the button must not render before the client has finished
  // starting, same as the rest of this sidebar's Concord chrome.
  const showUnlockAffordance = $derived(concordReady && listLocked);

  async function handleUnlockAreas() {
    const ok = await unlockConcordLists();
    if (!ok) showToast(m.concord_unlock_failed(), 'error');
  }
</script>

<!-- Sidebar -->
<div class="mb-4 space-y-2">
  <div class="flex items-center justify-between">
    <h2 class="text-base font-semibold text-base-content">{m.sidebar_joined_communities()}</h2>
    {#if activeUser()}
      <button
        class="hover:btn-primary-focus btn transition-colors duration-200 btn-sm btn-primary"
        onclick={() => modalStore.openModal('createCommunity')}
      >
        {m.sidebar_new_group()}
      </button>
    {/if}
  </div>

  {#if activeUser()}
    <a href={resolve('/discover')} class="btn btn-block gap-2 btn-outline btn-sm">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      {m.sidebar_discover_communities()}
    </a>
  {/if}
</div>

<div class="space-y-2">
  {#each [...joinedCommunities].sort() as communityPubKey (communityPubKey)}
    {@const getCommunityProfile = useUserProfile(communityPubKey)}
    {@const communityProfile = getCommunityProfile()}
    <a
      href={resolve(`/c/${hexToNpub(communityPubKey) || communityPubKey}`)}
      class="flex transform cursor-pointer items-center gap-2 rounded-lg border border-base-200 bg-base-100 p-3 shadow-sm transition-all duration-300 hover:scale-[1.02] hover:border-primary/20 hover:shadow-md"
    >
      <div class="avatar">
        <div
          class="h-8 w-8 rounded-full ring-2 ring-base-300 transition-colors duration-300 hover:ring-primary/50"
        >
          <ImageWithFallback
            src={getProfilePicture(communityProfile) || `https://robohash.org/${communityPubKey}`}
            alt="Community"
            fallbackType="community"
            class="h-full w-full rounded-full object-cover"
          />
        </div>
      </div>
      <div class="min-w-0 flex-1">
        <p
          class="truncate text-sm font-medium text-base-content transition-colors duration-300 hover:text-primary"
        >
          {getDisplayName(communityProfile)}
        </p>
      </div>
    </a>
  {/each}
  {#if joinedCommunities.length === 0}
    <div class="px-3 py-6 text-center">
      <p class="mb-3 text-sm text-base-content/60">{m.sidebar_no_communities()}</p>
      <a href={resolve('/discover')} class="btn btn-sm btn-primary">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        {m.sidebar_discover_communities()}
      </a>
    </div>
  {/if}
</div>

{#if runtimeConfig.concord?.enabled && (unlinkedAreas.length > 0 || showUnlockAffordance)}
  <div class="mt-4 space-y-2">
    <h2 class="text-base font-semibold text-base-content">{m.concord_sidebar_private_areas()}</h2>
    {#if showUnlockAffordance}
      <button
        class="btn btn-block gap-2 btn-outline btn-sm"
        data-testid="concord_unlock_areas"
        disabled={!signerHasNip44 || unlocking}
        title={signerHasNip44 ? undefined : m.concord_direct_needs_nip44()}
        onclick={handleUnlockAreas}
      >
        {#if unlocking}
          <span class="loading loading-xs loading-spinner"></span>
        {:else}
          <LockOpenIcon class_="h-4 w-4" />
        {/if}
        {m.concord_unlock_areas()}
      </button>
    {/if}
    <div class="space-y-2">
      {#each unlinkedAreas as area (area.communityId)}
        {@const areaFlags = areaUnreadState(area.communityId)}
        <a
          href={resolve(`/private/${area.communityId}`)}
          class="flex transform cursor-pointer items-center gap-2 rounded-lg border border-base-200 bg-base-100 p-3 shadow-sm transition-all duration-300 hover:scale-[1.02] hover:border-primary/20 hover:shadow-md"
        >
          <span class="relative shrink-0">
            <ConcordAreaBadge
              name={area.name}
              communityId={area.communityId}
              iconPointer={area.iconPointer}
              class="h-8 w-8 shrink-0"
            />
            <span class="absolute -top-0.5 -right-0.5">
              <ConcordUnreadDot unread={areaFlags.unread} mentioned={areaFlags.mentioned} />
            </span>
          </span>
          <p
            class="min-w-0 flex-1 truncate text-sm font-medium text-base-content transition-colors duration-300 hover:text-primary {area.dissolved
              ? 'opacity-50'
              : ''}"
          >
            {area.name}
          </p>
        </a>
      {/each}
    </div>
  </div>
{/if}

{#if unlinkedGroupRows.length > 0}
  <div class="mt-4 space-y-2">
    <h2 class="text-base font-semibold text-base-content">{m.groups_sidebar_my_groups()}</h2>
    <div class="space-y-2">
      {#each unlinkedGroupRows as row (row.key)}
        <a
          href={groupHref(row.pointer)}
          data-testid="sidebar-group-row"
          class="flex transform cursor-pointer items-center gap-2 rounded-lg border border-base-200 bg-base-100 p-3 shadow-sm transition-all duration-300 hover:scale-[1.02] hover:border-primary/20 hover:shadow-md"
        >
          <span
            aria-hidden="true"
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-base-200 text-sm"
            >{row.symbol}</span
          >
          <p
            class="min-w-0 flex-1 truncate text-sm font-medium text-base-content transition-colors duration-300 hover:text-primary"
          >
            {row.name}
          </p>
          {#if row.worldReadable}
            <span
              aria-hidden="true"
              data-testid="sidebar-group-world-readable"
              title={m.groups_channel_world_readable()}
              class="shrink-0 text-[0.7rem] opacity-80">&#127760;</span
            >
          {/if}
          {#if row.locked}
            <span
              aria-hidden="true"
              data-testid="sidebar-group-locked"
              title={m.concord_legend_private()}
              class="shrink-0 text-[0.7rem] opacity-60">&#128274;</span
            >
          {/if}
        </a>
      {/each}
    </div>
  </div>
{/if}
