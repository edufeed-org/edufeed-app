<!--
  DashboardFollowsFeed — Thin wrapper that passes followed pubkeys to ProfileFeedView.
  Handles loading/empty states specific to the follows context.
-->

<script>
  import { contactsStore } from '$lib/stores/contacts.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte.js';
  import ProfileFeedView from '$lib/components/profile/ProfileFeedView.svelte';
  import DashboardFeedSelector from '$lib/components/dashboard/DashboardFeedSelector.svelte';
  import FeedComposer from '$lib/components/dashboard/FeedComposer.svelte';
  import * as m from '$lib/paraglide/messages';

  const activeUser = useActiveUser();
</script>

<div class="mb-4 flex items-center gap-3">
  <h1 class="text-2xl font-extrabold tracking-tight">{m.dashboard_nav_feed()}</h1>
  <div class="ml-auto">
    <DashboardFeedSelector />
  </div>
</div>
<FeedComposer />

{#if contactsStore.isLoading}
  <div class="flex flex-col items-center justify-center py-16">
    <span class="loading loading-lg loading-spinner text-primary"></span>
    <p class="mt-4 text-base-content/60">{m.dashboard_follows_feed_loading()}</p>
  </div>
{:else if contactsStore.contacts.length === 0}
  <div class="flex flex-col items-center justify-center py-16 text-center">
    <div class="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-base-200">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-12 w-12 text-base-content/40"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    </div>
    <h3 class="mb-2 text-lg font-semibold text-base-content">
      {m.dashboard_follows_feed_empty_title()}
    </h3>
    <p class="max-w-md text-base-content/60">{m.dashboard_follows_feed_empty_description()}</p>
  </div>
{:else}
  <ProfileFeedView
    pubkeys={contactsStore.contacts}
    activeUser={activeUser()}
    userPubkey={activeUser()?.pubkey}
  />
{/if}
