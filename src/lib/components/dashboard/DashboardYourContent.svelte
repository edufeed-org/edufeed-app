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
  import { getPollRelays } from '$lib/loaders/polls.js';
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { getContentEventRoute } from '$lib/helpers/contentNavigation.js';
  import { getFeedCardData } from '$lib/helpers/feedCardData.js';
  import { navigateToCreate, CONTENT_CREATION } from '$lib/helpers/contentCreation.js';
  import FeedCard from '$lib/components/shared/FeedCard.svelte';
  import { FilesIcon, PlusIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ pubkey: string }} */
  let { pubkey } = $props();

  /** @typedef {{ label: () => string, kinds: number[], ctaKey?: string }} FilterDef */
  /** @type {Record<string, FilterDef>} */
  const FILTERS = {
    all: { label: () => m.common_all(), kinds: [] },
    calendar: { label: () => m.feed_badge_calendar(), kinds: [31922, 31923], ctaKey: 'calendar' },
    learning: { label: () => m.feed_badge_learning(), kinds: [30142], ctaKey: 'learning' },
    article: { label: () => m.feed_badge_article(), kinds: [30023], ctaKey: 'article' },
    wiki: { label: () => m.feed_badge_wiki(), kinds: [30818], ctaKey: 'wiki' },
    form: { label: () => m.dashboard_content_forms(), kinds: [30168], ctaKey: 'form' },
    poll: { label: () => m.dashboard_content_polls(), kinds: [1068], ctaKey: 'poll' },
    bookmark: { label: () => m.feed_badge_bookmark(), kinds: [39701], ctaKey: 'bookmark' }
  };

  /** @type {Record<string, () => string>} */
  const CTA_LABELS = {
    calendar: () => m.fab_create_event(),
    learning: () => m.fab_create_learning(),
    article: () => m.article_fab_write(),
    wiki: () => m.wiki_fab_write(),
    form: () => m.fab_create_form(),
    poll: () => m.fab_create_poll(),
    bookmark: () => m.fab_add_bookmark()
  };

  let activeFilter = $state('all');
  let items = $state.raw(/** @type {any[]} */ ([]));
  let isLoading = $state(true);

  // All content kinds we load
  const ALL_KINDS = [31922, 31923, 30142, 30023, 30818, 30168, 1068, 39701];

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
      { relays: getAllLookupRelays(), kinds: [30818, 30168, 39701] },
      { relays: getPollRelays(), kinds: [1068] }
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

  /** @param {any} event */
  function navigateToEvent(event) {
    const route = getContentEventRoute(event);
    if (route) goto(resolve(/** @type {any} */ (route)));
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
      <p class="mb-4 text-base-content/60">{m.dashboard_content_empty()}</p>

      {#if activeFilter !== 'all' && FILTERS[activeFilter]?.ctaKey}
        <button
          class="btn gap-2 btn-sm btn-primary"
          onclick={() => navigateToCreate(/** @type {string} */ (FILTERS[activeFilter].ctaKey))}
        >
          <PlusIcon class_="h-4 w-4" />
          {CTA_LABELS[/** @type {string} */ (FILTERS[activeFilter].ctaKey)]?.() ?? ''}
        </button>
      {:else if activeFilter === 'all'}
        <div class="flex flex-wrap justify-center gap-2">
          {#each Object.keys(CONTENT_CREATION) as key (key)}
            <button class="btn gap-2 btn-outline btn-sm" onclick={() => navigateToCreate(key)}>
              <PlusIcon class_="h-4 w-4" />
              {CTA_LABELS[key]?.() ?? key}
            </button>
          {/each}
        </div>
      {/if}
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
          authorPubkey={event.pubkey}
          timestamp={event.created_at}
          onclick={() => navigateToEvent(event)}
        />
      {/each}
    </div>
  {/if}
</section>
