<!--
  DashboardYourContent — Shows the logged-in user's created content.
  Loads from multiple relay categories and displays with FeedCard + filter pills.
-->

<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import { TimelineModel } from 'applesauce-core/models';
  import { timedPool } from '$lib/loaders/base.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import {
    getCalendarRelays,
    getEducationalRelays,
    getArticleRelays,
    getAllLookupRelays
  } from '$lib/helpers/relay-helper.js';
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils';
  import { getFeedCardData } from '$lib/helpers/feedCardData.js';
  import FeedCard from '$lib/components/shared/FeedCard.svelte';
  import { FilesIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ pubkey: string }} */
  let { pubkey } = $props();

  /** @typedef {{ label: () => string, kinds: number[] }} FilterDef */
  /** @type {Record<string, FilterDef>} */
  const FILTERS = {
    all: { label: () => m.common_all(), kinds: [] },
    calendar: { label: () => m.feed_badge_calendar(), kinds: [31922, 31923] },
    learning: { label: () => m.feed_badge_learning(), kinds: [30142] },
    article: { label: () => m.feed_badge_article(), kinds: [30023] },
    wiki: { label: () => m.feed_badge_wiki(), kinds: [30818] },
    form: { label: () => m.dashboard_content_forms(), kinds: [30168] }
  };

  let activeFilter = $state('all');
  let items = $state.raw(/** @type {any[]} */ ([]));
  let isLoading = $state(true);

  // All content kinds we load
  const ALL_KINDS = [31922, 31923, 30142, 30023, 30818, 30168];

  const getProfiles = useProfileMap(() => items.map((i) => i.pubkey));
  let profiles = $derived(getProfiles());

  let filteredItems = $derived.by(() => {
    const filterDef = FILTERS[activeFilter];
    if (!filterDef || filterDef.kinds.length === 0) return items;
    const kindSet = new Set(filterDef.kinds);
    return items.filter((item) => kindSet.has(item.kind));
  });

  // Load user content from multiple relay categories
  $effect(() => {
    if (!pubkey) {
      isLoading = false;
      return;
    }

    items = [];
    isLoading = true;

    /** @type {import('rxjs').Subscription[]} */
    const subs = [];

    // Load from each relay category
    const relayGroups = [
      { relays: getCalendarRelays(), kinds: [31922, 31923] },
      { relays: getEducationalRelays(), kinds: [30142] },
      { relays: getArticleRelays(), kinds: [30023] },
      { relays: getAllLookupRelays(), kinds: [30818, 30168] }
    ];

    for (const { relays, kinds } of relayGroups) {
      if (relays.length === 0) continue;
      const filter = { kinds, authors: [pubkey], limit: 50 };
      const loader = createTimelineLoader(timedPool, relays, filter, { eventStore });
      subs.push(
        loader().subscribe({
          error: (err) => console.error('DashboardYourContent: Loader error:', err)
        })
      );
    }

    // Single model subscription for all kinds
    const modelSub = eventStore
      .model(TimelineModel, { kinds: ALL_KINDS, authors: [pubkey] })
      .subscribe({
        next: (loaded) => {
          items = loaded || [];
          isLoading = false;
        }
      });
    subs.push(modelSub);

    return () => subs.forEach((s) => s.unsubscribe());
  });

  /** @type {Record<number, string>} */
  const KIND_ROUTE_PREFIX = {
    31922: '/calendar/event/',
    31923: '/calendar/event/',
    30142: '/discover?resource=',
    30023: '/',
    30818: '/',
    30168: '/forms/'
  };

  /**
   * @param {any} event
   */
  function navigateToEvent(event) {
    const naddr = encodeEventToNaddr(event);
    if (!naddr) return;

    const prefix = KIND_ROUTE_PREFIX[event.kind];
    if (prefix) {
      goto(resolve(`${prefix}${naddr}`));
    } else {
      goto(resolve(`/${naddr}`));
    }
  }
</script>

<section data-testid="dashboard-your-content">
  <div class="mb-4 flex items-center justify-between">
    <h2 class="text-lg font-bold">{m.dashboard_content_title()}</h2>
  </div>

  <!-- Filter Pills -->
  <div class="mb-4 flex flex-wrap gap-2">
    {#each Object.entries(FILTERS) as [key, filterDef] (key)}
      <button
        class="btn btn-sm {activeFilter === key ? 'btn-primary' : 'btn-ghost'}"
        onclick={() => (activeFilter = key)}
      >
        {filterDef.label()}
      </button>
    {/each}
  </div>

  {#if isLoading}
    <div class="flex justify-center py-8">
      <span class="loading loading-md loading-spinner text-primary"></span>
    </div>
  {:else if filteredItems.length === 0}
    <div
      class="flex flex-col items-center justify-center rounded-lg border border-base-300 bg-base-200/50 py-12 text-center"
    >
      <FilesIcon class_="mb-3 h-10 w-10 text-base-content/30" />
      <p class="text-base-content/60">{m.dashboard_content_empty()}</p>
    </div>
  {:else}
    <div class="grid gap-3 sm:grid-cols-2">
      {#each filteredItems as event (event.id)}
        {@const cardData = getFeedCardData(event)}
        {@const profile = profiles.get(event.pubkey)}
        <FeedCard
          title={cardData.title}
          subtitle={cardData.subtitle}
          typeKey={cardData.typeKey}
          kind={event.kind}
          tags={cardData.tags}
          description={cardData.description}
          authorName={profile ? getDisplayName(profile) : undefined}
          authorAvatar={profile ? getProfilePicture(profile) : undefined}
          timestamp={event.created_at}
          onclick={() => navigateToEvent(event)}
        />
      {/each}
    </div>
  {/if}
</section>
