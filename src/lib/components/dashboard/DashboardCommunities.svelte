<!--
  DashboardCommunities — Shows the user's joined communities as a card grid.
  Reuses CommunikeyCard (same card used on /discover?type=communities).
-->

<script>
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';
  import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import CommunikeyCard from '$lib/components/CommunikeyCard.svelte';
  import { PeopleIcon, SearchIcon, PlusIcon } from '$lib/components/icons';

  const getJoinedCommunities = useJoinedCommunitiesList();
  let joinedCommunities = $derived(getJoinedCommunities());
</script>

{#snippet createCard()}
  <button
    type="button"
    data-testid="dashboard-communities-create-card"
    onclick={() => modalStore.openModal('createCommunity')}
    class="card flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-base-300 bg-base-100 p-6 text-base-content/60 shadow-sm transition-all duration-300 hover:scale-105 hover:border-primary hover:bg-primary/5 hover:text-primary hover:shadow-lg"
  >
    <div
      class="flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-current"
    >
      <PlusIcon class_="w-10 h-10" />
    </div>
    <span class="text-xl font-semibold">{m.dashboard_communities_create()}</span>
  </button>
{/snippet}

<section data-testid="dashboard-communities">
  <div class="mb-4 flex items-center justify-between">
    <h2 class="text-lg font-bold">{m.dashboard_communities_title()}</h2>
    <a href={resolve('/discover?type=communities')} class="btn gap-1 btn-ghost btn-sm">
      <SearchIcon class_="w-4 h-4" />
      {m.dashboard_communities_discover()}
    </a>
  </div>

  {#if joinedCommunities.length === 0}
    <div
      class="flex flex-col items-center justify-center rounded-lg border border-base-300 bg-base-200/50 py-12 text-center"
    >
      <PeopleIcon class_="mb-3 h-10 w-10 text-base-content/30" />
      <p class="text-base-content/60">{m.dashboard_communities_empty()}</p>
      <a href={resolve('/discover?type=communities')} class="btn mt-3 btn-sm btn-primary">
        {m.dashboard_communities_explore()}
      </a>
      <div class="mt-4 w-full max-w-xs px-4">
        {@render createCard()}
      </div>
    </div>
  {:else}
    <div
      data-testid="dashboard-communities-grid"
      class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
    >
      {@render createCard()}
      {#each joinedCommunities as pubkey (pubkey)}
        <CommunikeyCard {pubkey} />
      {/each}
    </div>
  {/if}
</section>
