<!--
  DashboardRelayFeed — recent events seen on a single relay. The relay is
  the curation: no author/WoT filtering. One createTimelineFeed per relay
  pages it (the applesauce v7 window loader, prefetch = page size); display
  filters the shared EventStore by relay provenance (getSeenRelays), so only
  events actually seen on this relay show.
-->

<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { createTimelineFeed } from '$lib/loaders/timeline-feed.js';
  import { TimelineModel } from 'applesauce-core/models';
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { ALL_FEED_KINDS } from '$lib/helpers/profile-feed.js';
  import { withoutChannelMeetings } from '$lib/helpers/calendar-timing.js';
  import { withoutPlaceholderBoards } from '$lib/helpers/kanban-boards.js';
  import { filterEventsForRelay, relayHostLabel } from '$lib/helpers/relay-feed.js';
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
  // The relay's last request failed and the SDK is backing off before a retry
  let failing = $state(false);
  let displayCount = $state(DISPLAY_STEP);

  /** @type {import('$lib/loaders/timeline-feed.js').TimelineFeed | undefined} */
  let feed;

  // The feed is recreated on relay switch so coverage never carries over
  // between relays. Its status$ drives the button: `pending` while a page the
  // buffer does not hold yet is loading, `exhausted` once the relay has
  // nothing older.
  $effect(() => {
    const relayUrl = relay; // read the dep before anything else
    isLoading = true;
    displayCount = DISPLAY_STEP;
    const current = createTimelineFeed({
      getRelays: () => [relayUrl],
      getFilter: () => ({ kinds: ALL_FEED_KINDS }),
      pageSize: PAGE_SIZE,
      // Cached events carry no relay provenance and never pass the display
      // filter below, so warming the store from IDB only costs a query here.
      cacheWarmLimit: 0
    });
    feed = current;
    const eventsSub = current.events$.subscribe({
      error: (/** @type {any} */ err) => console.error('DashboardRelayFeed: feed error:', err)
    });
    const statusSub = current.status$.subscribe((status) => {
      loadingPage = status.pending;
      exhausted = status.exhausted;
      failing = status.failing;
      if (status.settled) isLoading = false;
    });
    const modelSub = eventStore
      .model(TimelineModel, { kinds: ALL_FEED_KINDS })
      .subscribe((/** @type {any[]} */ events) => {
        // Channel meetings share the store but never appear in a feed; a board
        // that was never named says nothing to a reader either.
        modelEvents = withoutPlaceholderBoards(withoutChannelMeetings(events || []));
      });
    return () => {
      eventsSub.unsubscribe();
      statusSub.unsubscribe();
      modelSub.unsubscribe();
      feed = undefined;
    };
  });

  // Provenance filter: the EventStore is shared app-wide, so restrict the
  // timeline to events actually seen on this relay.
  let feedItems = $derived(filterEventsForRelay(modelEvents, relay));
  let visibleItems = $derived(feedItems.slice(0, displayCount));
  // While the relay is failing the SDK retries on its own: keep the button
  // (busy) instead of declaring the relay empty.
  let hasMore = $derived(!exhausted || failing || displayCount < feedItems.length);

  const getProfiles = useProfileMap(() => visibleItems.map((e) => e.pubkey));
  let profiles = $derived(getProfiles());

  function loadMore() {
    displayCount += DISPLAY_STEP;
    // Running low on already-fetched items — widen the feed's window by a page
    if (displayCount >= feedItems.length) feed?.loadMore();
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

{#if isLoading && visibleItems.length === 0}
  <!-- Store first: the spinner only while nothing from this relay is rendered yet -->
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
      <button class="btn btn-ghost btn-sm" onclick={loadMore} disabled={loadingPage || failing}>
        {#if loadingPage || failing}
          <span class="loading loading-xs loading-spinner"></span>
        {/if}
        {m.discover_load_more()}
      </button>
    </div>
  {/if}
{/if}
