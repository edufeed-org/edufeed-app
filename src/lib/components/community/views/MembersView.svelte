<script>
  import { getContext } from 'svelte';
  import { getVerifiedMembers } from '$lib/helpers/contentTypes.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import ProfileCard from '$lib/components/shared/ProfileCard.svelte';
  import * as m from '$lib/paraglide/messages';

  let { communikeyEvent } = $props();

  /** @type {import('$lib/stores/profile-list-access.svelte.js').ProfileListAccess} */
  const profileAccess = getContext('profileAccess');

  let memberData = $derived(getVerifiedMembers(profileAccess, communikeyEvent));

  const getProfiles = useProfileMap(() => memberData.allMembers);
  let profiles = $derived(getProfiles());

  /** Get section names a pubkey belongs to */
  function getSectionsForPubkey(/** @type {string} */ pubkey) {
    /** @type {string[]} */
    const sections = [];
    for (const [name, members] of memberData.perSection) {
      if (members.includes(pubkey)) sections.push(name);
    }
    return sections;
  }

  let isOwner = (/** @type {string} */ pubkey) => communikeyEvent?.pubkey === pubkey;
</script>

<div class="container mx-auto max-w-4xl px-4 py-8">
  <h2 class="mb-6 text-xl font-bold">{m.community_members_title()}</h2>

  {#if profileAccess.isLoading}
    <div class="flex flex-col items-center justify-center py-12">
      <span class="loading loading-lg loading-spinner text-primary"></span>
      <p class="mt-4 text-sm text-base-content/60">{m.community_members_loading()}</p>
    </div>
  {:else if memberData.allMembers.length <= 1 && memberData.perSection.size === 0}
    <!-- Only owner, no gated sections -->
    <div class="card bg-base-100">
      <div class="card-body text-center">
        <p class="text-base-content/60">{m.community_members_open_community()}</p>
      </div>
    </div>

    <!-- Still show owner -->
    {#if communikeyEvent?.pubkey}
      <div class="mt-6">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div class="relative">
            <ProfileCard
              pubkey={communikeyEvent.pubkey}
              profile={profiles.get(communikeyEvent.pubkey)}
              size="sm"
              showNpub={false}
              showIcon={false}
            />
            <span class="absolute -top-2 -right-2 badge badge-sm badge-primary">
              {m.community_members_owner_badge()}
            </span>
          </div>
        </div>
      </div>
    {/if}
  {:else}
    <p class="mb-4 text-sm text-base-content/60">
      {m.community_members_count({ count: memberData.allMembers.length })}
    </p>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each memberData.allMembers as pubkey (pubkey)}
        {@const sections = getSectionsForPubkey(pubkey)}
        <div class="relative">
          <ProfileCard
            {pubkey}
            profile={profiles.get(pubkey)}
            size="sm"
            showNpub={false}
            showIcon={false}
          />
          <div class="absolute -top-2 -right-2 flex gap-1">
            {#if isOwner(pubkey)}
              <span class="badge badge-xs badge-primary">{m.community_members_owner_badge()}</span>
            {/if}
            {#each sections as section (section)}
              <span class="badge badge-outline badge-xs">{section}</span>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
