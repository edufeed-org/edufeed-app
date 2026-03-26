<!--
  DashboardCommunities — Shows the user's joined communities as a card grid.
  Uses useJoinedCommunitiesList() for pubkeys and useProfileMap() for profiles.
-->

<script>
  import { resolve } from '$app/paths';
  import { nip19 } from 'nostr-tools';
  import * as m from '$lib/paraglide/messages';
  import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { PeopleIcon } from '$lib/components/icons';

  const getJoinedCommunities = useJoinedCommunitiesList();
  let joinedCommunities = $derived(getJoinedCommunities());

  const getProfiles = useProfileMap(() => joinedCommunities);
  let profiles = $derived(getProfiles());

  /**
   * @param {string} pubkey
   * @returns {string}
   */
  function getCommunityName(pubkey) {
    const profile = profiles.get(pubkey);
    return profile?.name || profile?.displayName || pubkey.slice(0, 8) + '...';
  }

  /**
   * @param {string} pubkey
   * @returns {string}
   */
  function getCommunityLink(pubkey) {
    try {
      const npub = nip19.npubEncode(pubkey);
      return resolve(`/c/${npub}`);
    } catch {
      return resolve(`/c/${pubkey}`);
    }
  }
</script>

<section data-testid="dashboard-communities">
  <div class="mb-4 flex items-center justify-between">
    <h2 class="text-lg font-bold">{m.dashboard_communities_title()}</h2>
    <a href={resolve('/communities')} class="btn btn-ghost btn-sm">
      {m.dashboard_communities_view_all()} →
    </a>
  </div>

  {#if joinedCommunities.length === 0}
    <div
      class="flex flex-col items-center justify-center rounded-lg border border-base-300 bg-base-200/50 py-12 text-center"
    >
      <PeopleIcon class_="mb-3 h-10 w-10 text-base-content/30" />
      <p class="text-base-content/60">{m.dashboard_communities_empty()}</p>
      <a href={resolve('/communities')} class="btn mt-3 btn-sm btn-primary">
        {m.dashboard_communities_explore()}
      </a>
    </div>
  {:else}
    <div class="flex gap-3 overflow-x-auto pb-2 lg:grid lg:grid-cols-3 lg:overflow-visible">
      {#each joinedCommunities as pubkey (pubkey)}
        <a
          href={getCommunityLink(pubkey)}
          class="flex min-w-[200px] flex-shrink-0 items-center gap-3 rounded-lg border border-base-300 bg-base-100 p-3 shadow-sm transition-shadow hover:border-primary hover:shadow-md lg:min-w-0"
        >
          <ProfileAvatar {pubkey} size="md" fallbackType="robohash" />
          <span class="truncate font-medium">{getCommunityName(pubkey)}</span>
        </a>
      {/each}
    </div>
  {/if}
</section>
