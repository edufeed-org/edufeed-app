<!--
  DashboardCommunities — Shows the user's joined communities as a card grid.
  The grid always leads with a Discover tile + a Create tile so both actions
  are equally discoverable. Joined communities (if any) follow.
-->

<script>
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';
  import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import CommunikeyCard from '$lib/components/CommunikeyCard.svelte';
  import { SearchIcon, PlusIcon } from '$lib/components/icons';

  const getJoinedCommunities = useJoinedCommunitiesList();
  let joinedCommunities = $derived(getJoinedCommunities());
</script>

<!--
  Tile shape mirrors CommunikeyCard's vertical rhythm so action tiles and
  community cards line up: 96px round avatar, title, subtitle line.
-->
{#snippet discoverCard()}
  <a
    href={resolve('/discover?type=communities')}
    data-testid="dashboard-communities-discover-card"
    class="card flex transform cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-base-200 bg-base-100 p-6 text-center shadow-md transition-all duration-300 hover:scale-105 hover:border-primary/30 hover:shadow-lg"
  >
    <div
      class="mb-3 flex h-24 w-24 items-center justify-center rounded-full bg-primary/10 text-primary"
    >
      <SearchIcon class_="w-10 h-10" />
    </div>
    <h2 class="card-title text-xl font-semibold">{m.dashboard_communities_discover()}</h2>
    <p class="text-sm text-base-content/60">{m.dashboard_communities_discover_subtitle()}</p>
  </a>
{/snippet}

{#snippet createCard()}
  <button
    type="button"
    data-testid="dashboard-communities-create-card"
    onclick={() => modalStore.openModal('createCommunity')}
    class="card flex transform cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-base-300 bg-base-100 p-6 text-center text-base-content/70 shadow-sm transition-all duration-300 hover:scale-105 hover:border-primary hover:bg-primary/5 hover:text-primary hover:shadow-lg"
  >
    <div
      class="mb-3 flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-current"
    >
      <PlusIcon class_="w-10 h-10" />
    </div>
    <h2 class="card-title text-xl font-semibold">{m.dashboard_communities_create()}</h2>
    <p class="text-sm opacity-70">{m.dashboard_communities_create_subtitle()}</p>
  </button>
{/snippet}

<section data-testid="dashboard-communities">
  <div class="mb-4">
    <h2 class="text-lg font-bold">{m.dashboard_communities_title()}</h2>
  </div>

  {#if joinedCommunities.length === 0}
    <p class="mb-4 text-sm text-base-content/60">{m.dashboard_communities_empty()}</p>
  {/if}

  <div
    data-testid="dashboard-communities-grid"
    class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
  >
    {@render discoverCard()}
    {@render createCard()}
    {#each joinedCommunities as pubkey (pubkey)}
      <CommunikeyCard {pubkey} />
    {/each}
  </div>
</section>
