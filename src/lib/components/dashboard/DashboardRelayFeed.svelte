<!--
  DashboardRelayFeed — recent events seen on a single relay. The relay is
  the curation: no author/WoT filtering. A timeline loader pages the relay
  directly; display filters the shared EventStore by relay provenance
  (getSeenRelays), so only events actually seen on this relay show.
-->

<script>
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import { TimelineModel } from 'applesauce-core/models';
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { timedPool } from '$lib/loaders/base.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { ALL_FEED_KINDS } from '$lib/helpers/profile-feed.js';
  import { filterEventsForRelay, relayHostLabel } from '$lib/helpers/relay-feed.js';
  import { createRelayPageLoader } from '$lib/helpers/relay-page-loader.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getFeedCardData } from '$lib/helpers/feedCardData.js';
  import { getContentEventRoute } from '$lib/helpers/contentNavigation.js';
  import FeedCard from '$lib/components/shared/FeedCard.svelte';
  import EmptyState from '$lib/components/shared/EmptyState.svelte';
  import RichFeedEntry from '$lib/components/dashboard/RichFeedEntry.svelte';
  import DashboardFeedSelector from '$lib/components/dashboard/DashboardFeedSelector.svelte';
  import FeedComposer from '$lib/components/dashboard/FeedComposer.svelte';
  import { RelayIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ relay: string }} */
  let { relay } = $props();

  const getActiveUser = useActiveUser();

  const PAGE_SIZE = 30;
  const DISPLAY_STEP = 15;

  let modelEvents = $state.raw(/** @type {any[]} */ ([]));
  let isLoading = $state(true);
  let exhausted = $state(false);
  let loadingPage = $state(false);
  let displayCount = $state(DISPLAY_STEP);

  /** @type {(() => import('rxjs').Observable<any>) | undefined} */
  let loader;

  // createTimelineLoader's observable may never complete (timedPool is 2s,
  // +buffer) — the pager finalizes each page via a 4s safety timeout and is
  // cancelled on relay switch/unmount so pagination state never goes stale.
  const pager = createRelayPageLoader({
    timeout: 4_000,
    onChange: ({ loading, exhausted: pageExhausted, settled }) => {
      loadingPage = loading;
      exhausted = pageExhausted;
      if (settled) isLoading = false;
    }
  });

  $effect(() => {
    const relayUrl = relay; // read the dep before anything else
    isLoading = true;
    displayCount = DISPLAY_STEP;
    // Cancel any in-flight page and clear pagination state for the new relay
    pager.reset();
    loader = createTimelineLoader(
      timedPool,
      [relayUrl],
      { kinds: ALL_FEED_KINDS, limit: PAGE_SIZE },
      { eventStore }
    );
    const modelSub = eventStore
      .model(TimelineModel, { kinds: ALL_FEED_KINDS })
      .subscribe((/** @type {any[]} */ events) => {
        modelEvents = events || [];
      });
    // Untracked: the pager callback writes pagination $state which must not
    // become an effect dependency — the effect tracks only `relay`.
    untrack(() => pager.loadPage(loader));
    return () => {
      modelSub.unsubscribe();
      pager.cancel();
      loader = undefined;
    };
  });

  // Provenance filter: the EventStore is shared app-wide, so restrict the
  // timeline to events actually seen on this relay.
  let feedItems = $derived(filterEventsForRelay(modelEvents, relay));
  let visibleItems = $derived(feedItems.slice(0, displayCount));
  let hasMore = $derived(!exhausted || displayCount < feedItems.length);

  const getProfiles = useProfileMap(() => visibleItems.map((e) => e.pubkey));
  let profiles = $derived(getProfiles());

  function loadMore() {
    displayCount += DISPLAY_STEP;
    // Running low on already-fetched items — pull the next page from the relay
    if (displayCount >= feedItems.length) pager.loadPage(loader);
  }

  /** @param {any} event */
  function navigateToEvent(event) {
    const route = getContentEventRoute(event, {});
    if (route) goto(resolve(/** @type {any} */ (route)));
  }
</script>

<div class="mb-4 flex items-center gap-3">
  <h1 class="text-2xl font-extrabold tracking-tight">{m.dashboard_nav_feed()}</h1>
  <div class="ml-auto">
    <DashboardFeedSelector />
  </div>
</div>
<FeedComposer />

{#if isLoading}
  <div class="flex justify-center py-12">
    <span class="loading loading-lg loading-spinner text-primary"></span>
  </div>
{:else if visibleItems.length === 0}
  <EmptyState
    title={m.dashboard_relay_feed_empty_title()}
    description={`${relayHostLabel(relay)} — ${m.dashboard_relay_feed_empty_description()}`}
  >
    {#snippet icon()}
      <RelayIcon class_="h-10 w-10" />
    {/snippet}
  </EmptyState>
{:else}
  <div class="space-y-4" data-testid="dashboard-relay-feed">
    {#each visibleItems as event (event.id)}
      {@const cardData = getFeedCardData(event)}
      {@const profile = profiles.get(event.pubkey)}
      {#snippet compactCard()}
        <FeedCard
          title={cardData.title}
          subtitle={cardData.subtitle}
          typeKey={cardData.typeKey}
          kind={event.kind}
          tags={cardData.tags}
          description={cardData.description}
          location={cardData.location}
          authorName={profile ? getDisplayName(profile) : undefined}
          authorAvatar={profile ? getProfilePicture(profile) : undefined}
          authorPubkey={event.pubkey}
          {event}
          timestamp={event.created_at}
          onclick={() => navigateToEvent(event)}
        />
      {/snippet}
      <RichFeedEntry
        {event}
        authorProfile={profile ?? null}
        authorProfiles={profiles}
        activeUser={getActiveUser()}
        fallback={compactCard}
      />
    {/each}
  </div>

  {#if hasMore}
    <div class="mt-4 flex justify-center">
      <button class="btn btn-ghost btn-sm" onclick={loadMore} disabled={loadingPage}>
        {#if loadingPage}
          <span class="loading loading-xs loading-spinner"></span>
        {/if}
        {m.discover_load_more()}
      </button>
    </div>
  {/if}
{/if}
