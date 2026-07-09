<!--
  DashboardHome — the default dashboard view ("Home"): greeting with quick
  actions, inbox preview card, and a short community-feed preview with the
  upcoming-events rail (rendered by DashboardCommunityFeed in preview mode).
-->

<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { formatDate } from '$lib/helpers/dates.js';
  import { openCreateHub } from '$lib/stores/create-hub.svelte.js';
  import {
    CalendarIcon,
    ChevronRightIcon,
    PeopleIcon,
    PlusIcon,
    SearchIcon
  } from '$lib/components/icons';
  import HomeInboxCard from '$lib/components/inbox/HomeInboxCard.svelte';
  import DashboardCommunityFeed from '$lib/components/dashboard/DashboardCommunityFeed.svelte';
  import * as m from '$lib/paraglide/messages';

  const PREVIEW_COUNT = 3;

  const getProfile = useUserProfile();
  let displayName = $derived.by(() => {
    const profile = getProfile();
    const name = profile ? getDisplayName(profile) : '';
    // getDisplayName falls back to a truncated npub — not a greeting name
    return name && !name.startsWith('npub1') ? name : '';
  });

  const todayLabel = formatDate(new Date(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
</script>

<div data-testid="dashboard-home">
  <!-- Greeting + quick actions -->
  <div class="mb-6 flex flex-wrap items-end gap-5">
    <div class="min-w-[200px] flex-1">
      <div class="mb-2 flex items-center gap-2 text-[13px] font-medium text-base-content/60">
        <CalendarIcon class_="h-3.5 w-3.5" />
        {todayLabel}
      </div>
      <h1 class="text-3xl font-extrabold tracking-tight">
        {m.home_greeting_hello()}
        {#if displayName}
          <span
            class="align-baseline text-4xl font-bold text-secondary"
            style="font-family: var(--font-script)"
          >
            {displayName}
          </span>
        {/if}
        <span aria-hidden="true">👋</span>
      </h1>
    </div>
    <div class="flex flex-wrap gap-2.5">
      <button
        class="btn border-base-300 bg-base-100 btn-outline"
        onclick={() => goto(resolve('/discover'))}
      >
        <SearchIcon class_="h-4 w-4" />
        {m.home_quick_discover()}
      </button>
      <button class="btn btn-accent" onclick={openCreateHub}>
        <PlusIcon class_="h-4 w-4" />
        {m.home_quick_create()}
      </button>
    </div>
  </div>

  <HomeInboxCard />

  <!-- Community feed preview -->
  <div class="mt-6 mb-3.5 flex items-center gap-2.5">
    <h2 class="flex items-center gap-2 text-base font-bold">
      <PeopleIcon class_="h-[17px] w-[17px] text-primary" />
      {m.home_feed_preview_title()}
    </h2>
    <a
      class="ml-auto flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
      href={resolve('/c/') + '?view=feed'}
    >
      {m.home_feed_preview_link()}
      <ChevronRightIcon class_="h-3 w-3" />
    </a>
  </div>
  <DashboardCommunityFeed previewCount={PREVIEW_COUNT} />
</div>
