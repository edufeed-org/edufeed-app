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
  import { useUnlinkedConcordAreas } from '$lib/concord/unlinked-areas.svelte.js';
  import { LockIcon } from '$lib/components/icons';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import * as m from '$lib/paraglide/messages';

  const activeUser = useActiveUser();
  const getJoinedCommunities = useJoinedCommunitiesList(); // gets the getter function
  const joinedCommunities = $derived(getJoinedCommunities()); // reactive value

  const getUnlinkedAreas = useUnlinkedConcordAreas();
  const unlinkedAreas = $derived(getUnlinkedAreas());
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

{#if runtimeConfig.concord?.enabled && unlinkedAreas.length > 0}
  <div class="mt-4 space-y-2">
    <h2 class="text-base font-semibold text-base-content">{m.concord_sidebar_private_areas()}</h2>
    <div class="space-y-2">
      {#each unlinkedAreas as area (area.communityId)}
        <a
          href={resolve(`/private/${area.communityId}`)}
          class="flex transform cursor-pointer items-center gap-2 rounded-lg border border-base-200 bg-base-100 p-3 shadow-sm transition-all duration-300 hover:scale-[1.02] hover:border-primary/20 hover:shadow-md"
        >
          <LockIcon class_="h-4 w-4 shrink-0 text-base-content/60" />
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
