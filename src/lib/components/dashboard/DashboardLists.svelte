<!--
  DashboardLists — Shows the user's NIP-51 lists (bookmarks, follow sets, curation sets, etc.)
-->
<script>
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import { TimelineModel } from 'applesauce-core/models';
  import { timedPool } from '$lib/loaders/base.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import {
    getEventPointersFromList,
    getAddressPointersFromList,
    getProfilePointersFromList,
    getRelaysFromList
  } from 'applesauce-common/helpers';
  import { getWriteRelays } from '$lib/services/relay-service.svelte.js';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { parseRelayListEvent } from '$lib/services/relay-settings-service.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { getContentEventRoute } from '$lib/helpers/contentNavigation.js';
  import { getFeedCardData } from '$lib/helpers/feedCardData.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import FeedCard from '$lib/components/shared/FeedCard.svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import ExpandableListCard from './ExpandableListCard.svelte';
  import { BookmarkIcon } from '$lib/components/icons';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ pubkey: string }} */
  let { pubkey } = $props();

  // List kinds to fetch
  const SET_KINDS = [30003, 30000, 30004, 30002, 30015];
  const STANDARD_KINDS = [10003, 10001, 10000, 10002, 10007, 10015];

  // Standard (replaceable) list state
  /** @type {import('nostr-tools').NostrEvent | null} */
  let bookmarkList = $state(null);
  /** @type {import('nostr-tools').NostrEvent | null} */
  let pinnedList = $state(null);
  /** @type {import('nostr-tools').NostrEvent | null} */
  let muteList = $state(null);
  /** @type {import('nostr-tools').NostrEvent | null} */
  let relayList = $state(null);
  /** @type {import('nostr-tools').NostrEvent | null} */
  let searchRelayList = $state(null);
  /** @type {import('nostr-tools').NostrEvent | null} */
  let interestList = $state(null);

  // Parameterized set state
  /** @type {import('nostr-tools').NostrEvent[]} */
  let sets = $state.raw([]);
  let isLoading = $state(true);

  /** @type {string | null} */
  let expandedListId = $state(null);
  /** @type {import('nostr-tools').NostrEvent | null} */
  let expandedListEvent = $state(null);

  // Resolved events for expanded list items (event/address pointer lists)
  /** @type {import('nostr-tools').NostrEvent[]} */
  let resolvedEvents = $state.raw([]);

  const getProfiles = useProfileMap(() => resolvedEvents.map((e) => e.pubkey));
  let profiles = $derived(getProfiles());

  // Categorize sets
  let bookmarkSets = $derived(sets.filter((s) => s.kind === 30003));
  let followSets = $derived(
    sets.filter((s) => s.kind === 30000 && getSetDTag(s) !== 'communities')
  );
  let curationSets = $derived(sets.filter((s) => s.kind === 30004));
  let relaySets = $derived(
    sets.filter((s) => {
      if (s.kind !== 30002) return false;
      const dTag = getSetDTag(s);
      const appPrefix = (runtimeConfig.appName || 'ComCal') + '/';
      return !dTag.startsWith(appPrefix);
    })
  );
  let interestSets = $derived(sets.filter((s) => s.kind === 30015));

  /**
   * @param {import('nostr-tools').NostrEvent} event
   * @returns {string}
   */
  function getSetDTag(event) {
    return event.tags.find((t) => t[0] === 'd')?.[1] || '';
  }

  /**
   * @param {import('nostr-tools').NostrEvent} event
   * @returns {string}
   */
  function getSetTitle(event) {
    return event.tags.find((t) => t[0] === 'title')?.[1] || getSetDTag(event) || 'Untitled';
  }

  /**
   * Count event references in a list (public + private, matching what gets rendered)
   * @param {import('nostr-tools').NostrEvent} event
   * @returns {number}
   */
  function getEventItemCount(event) {
    return getEventPointersFromList(event).length + getAddressPointersFromList(event).length;
  }

  /**
   * Get hashtags from a list event
   * @param {import('nostr-tools').NostrEvent} event
   * @returns {string[]}
   */
  function getHashtags(event) {
    return event.tags.filter((t) => t[0] === 't').map((t) => t[1]);
  }

  /**
   * Pure mute list parser (avoids applesauce caching that triggers state_unsafe_mutation)
   * @param {import('nostr-tools').NostrEvent} event
   * @returns {{ pubkeys: Set<string>, hashtags: Set<string>, words: Set<string>, threads: Set<string> }}
   */
  function parseMutedThings(event) {
    const pubkeys = new Set(event.tags.filter((t) => t[0] === 'p').map((t) => t[1]));
    const hashtags = new Set(event.tags.filter((t) => t[0] === 't').map((t) => t[1]));
    const words = new Set(event.tags.filter((t) => t[0] === 'word').map((t) => t[1]));
    const threads = new Set(event.tags.filter((t) => t[0] === 'e').map((t) => t[1]));
    return { pubkeys, hashtags, words, threads };
  }

  /**
   * Toggle expanding a list to show its contents
   * @param {string} listId
   * @param {import('nostr-tools').NostrEvent | null} listEvent
   */
  function toggleExpand(listId, listEvent) {
    if (expandedListId === listId) {
      expandedListId = null;
      expandedListEvent = null;
      return;
    }
    expandedListId = listId;
    expandedListEvent = listEvent;
  }

  // Fetch + subscribe to referenced events when a list is expanded
  $effect(() => {
    if (!expandedListEvent) {
      resolvedEvents = [];
      return;
    }

    /** @type {import('rxjs').Subscription[]} */
    const subs = [];
    const eventPointers = getEventPointersFromList(expandedListEvent);
    const addressPointers = getAddressPointersFromList(expandedListEvent);
    /** @type {Map<string, import('nostr-tools').NostrEvent>} */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to $effect, not reactive state
    const collected = new Map();

    // Subscribe to EventStore immediately (sync)
    for (const pointer of eventPointers) {
      const sub = eventStore.event(pointer.id).subscribe((event) => {
        if (event && !collected.has(event.id)) {
          collected.set(event.id, event);
          resolvedEvents = Array.from(collected.values());
        }
      });
      subs.push(sub);
    }

    for (const pointer of addressPointers) {
      const sub = eventStore
        .replaceable(pointer.kind, pointer.pubkey, pointer.identifier)
        .subscribe((event) => {
          if (event && !collected.has(event.id)) {
            collected.set(event.id, event);
            resolvedEvents = Array.from(collected.values());
          }
        });
      subs.push(sub);
    }

    // Fetch from relays — use broad lookup relays since referenced events
    // can be from any author on any relay, not just the current user's relays
    const lookupRelays = getAllLookupRelays();

    if (eventPointers.length > 0) {
      // Collect relay hints from pointers and merge with lookup relays
      const hintRelays = eventPointers.flatMap((p) => p.relays || []);
      const relays = [...new Set([...hintRelays, ...lookupRelays])];
      const ids = eventPointers.map((p) => p.id);
      const loader = createTimelineLoader(timedPool, relays, { ids }, { eventStore });
      subs.push(loader().subscribe());
    }

    for (const pointer of addressPointers) {
      const hintRelays = pointer.relays || [];
      const relays = [...new Set([...hintRelays, ...lookupRelays])];
      const loader = createTimelineLoader(
        timedPool,
        relays,
        { kinds: [pointer.kind], authors: [pointer.pubkey], '#d': [pointer.identifier] },
        { eventStore }
      );
      subs.push(loader().subscribe());
    }

    return () => subs.forEach((s) => s.unsubscribe());
  });

  /** @param {any} event */
  function navigateToEvent(event) {
    const route = getContentEventRoute(event);
    if (route) goto(resolve(/** @type {any} */ (route)));
  }

  // Load user's NIP-51 lists
  $effect(() => {
    if (!pubkey) {
      isLoading = false;
      return;
    }

    isLoading = true;
    /** @type {import('rxjs').Subscription[]} */
    const subs = [];
    let cancelled = false;

    // Subscribe to EventStore immediately (sync — doesn't need relays)
    subs.push(
      eventStore.replaceable(10003, pubkey).subscribe((event) => {
        bookmarkList = event ?? null;
        isLoading = false;
      })
    );
    subs.push(
      eventStore.replaceable(10001, pubkey).subscribe((event) => {
        pinnedList = event ?? null;
      })
    );
    subs.push(
      eventStore.replaceable(10000, pubkey).subscribe((event) => {
        muteList = event ?? null;
      })
    );
    subs.push(
      eventStore.replaceable(10002, pubkey).subscribe((event) => {
        relayList = event ?? null;
      })
    );
    subs.push(
      eventStore.replaceable(10007, pubkey).subscribe((event) => {
        searchRelayList = event ?? null;
      })
    );
    subs.push(
      eventStore.replaceable(10015, pubkey).subscribe((event) => {
        interestList = event ?? null;
      })
    );

    subs.push(
      eventStore
        .model(TimelineModel, { kinds: SET_KINDS, authors: [pubkey] })
        .subscribe((loaded) => {
          sets = loaded || [];
          isLoading = false;
        })
    );

    // Fetch from user's NIP-65 write relays (async)
    getWriteRelays(pubkey).then((relays) => {
      if (cancelled) return;
      const allKinds = [...SET_KINDS, ...STANDARD_KINDS];
      const loader = createTimelineLoader(
        timedPool,
        relays,
        { kinds: allKinds, authors: [pubkey], limit: 50 },
        { eventStore }
      );
      subs.push(loader().subscribe());
    });

    return () => {
      cancelled = true;
      subs.forEach((s) => s.unsubscribe());
    };
  });

  // Check if there are any lists at all
  let hasAnyLists = $derived(
    bookmarkList !== null ||
      pinnedList !== null ||
      muteList !== null ||
      relayList !== null ||
      searchRelayList !== null ||
      interestList !== null ||
      bookmarkSets.length > 0 ||
      followSets.length > 0 ||
      curationSets.length > 0 ||
      relaySets.length > 0 ||
      interestSets.length > 0
  );
</script>

<!-- Reusable snippets for expanded content -->
{#snippet eventGrid()}
  <div class="grid gap-2 sm:grid-cols-2">
    {#each resolvedEvents as event (event.id)}
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
{/snippet}

{#snippet profileChips(pointers)}
  <div class="flex flex-wrap gap-3">
    {#each pointers as pointer (pointer.pubkey)}
      {@const getProfile = useUserProfile(() => pointer.pubkey)}
      {@const profile = getProfile()}
      {@const displayName = getDisplayName(profile) || `${pointer.pubkey.slice(0, 8)}...`}
      <a
        href={resolve(`/p/${pointer.pubkey}`)}
        class="flex items-center gap-2 rounded-full border border-base-300 bg-base-100 px-3 py-1.5 shadow-sm hover:shadow-md"
      >
        <ProfileAvatar pubkey={pointer.pubkey} size="sm" fallbackType="robohash" />
        <span class="text-sm">{displayName}</span>
      </a>
    {/each}
  </div>
{/snippet}

{#snippet hashtagPills(tags)}
  <div class="flex flex-wrap gap-2">
    {#each tags as tag (tag)}
      <span class="badge badge-outline">#{tag}</span>
    {/each}
  </div>
{/snippet}

{#snippet relayUrlList(relays)}
  <div class="space-y-1">
    {#each relays as relay (relay)}
      <div
        class="flex items-center gap-2 rounded border border-base-300 bg-base-100 px-3 py-1.5 font-mono text-sm"
      >
        {relay}
      </div>
    {/each}
  </div>
{/snippet}

{#snippet relayListWithMarkers(entries)}
  <div class="space-y-1">
    {#each entries as entry (entry.url)}
      <div
        class="flex items-center justify-between rounded border border-base-300 bg-base-100 px-3 py-1.5 text-sm"
      >
        <span class="font-mono">{entry.url}</span>
        <div class="flex gap-1">
          {#if entry.read}
            <span class="badge badge-sm badge-success">{m.dashboard_lists_relay_read()}</span>
          {/if}
          {#if entry.write}
            <span class="badge badge-sm badge-info">{m.dashboard_lists_relay_write()}</span>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/snippet}

<section data-testid="dashboard-lists">
  <h2 class="mb-4 text-lg font-bold">{m.dashboard_lists_title()}</h2>

  {#if isLoading}
    <div class="flex justify-center py-8">
      <span class="loading loading-md loading-spinner text-primary"></span>
    </div>
  {:else if !hasAnyLists}
    <div
      class="flex flex-col items-center justify-center rounded-lg border border-base-300 bg-base-200/50 py-12 text-center"
    >
      <BookmarkIcon class_="mb-3 h-10 w-10 text-base-content/30" />
      <p class="mb-2 text-base-content/60">{m.dashboard_lists_empty()}</p>
      <p class="text-sm text-base-content/40">{m.dashboard_lists_empty_hint()}</p>
    </div>
  {:else}
    <div class="space-y-3">
      <!-- Bookmarks (kind 10003) -->
      {#if bookmarkList}
        <ExpandableListCard
          title={m.dashboard_lists_bookmarks()}
          count={getEventItemCount(bookmarkList)}
          expanded={expandedListId === 'bookmarks'}
          toggle={() => toggleExpand('bookmarks', bookmarkList)}
        >
          {#snippet icon()}<BookmarkIcon class_="h-5 w-5 text-primary" filled />{/snippet}
          {#if resolvedEvents.length > 0}
            {@render eventGrid()}
          {/if}
        </ExpandableListCard>
      {/if}

      <!-- Bookmark Sets (kind 30003) -->
      {#each bookmarkSets as set (set.id)}
        {@const listId = `bset-${set.id}`}
        <ExpandableListCard
          title={getSetTitle(set)}
          count={getEventItemCount(set)}
          expanded={expandedListId === listId}
          toggle={() => toggleExpand(listId, set)}
        >
          {#snippet icon()}<BookmarkIcon class_="h-5 w-5 text-secondary" />{/snippet}
          {#if resolvedEvents.length > 0}
            {@render eventGrid()}
          {/if}
        </ExpandableListCard>
      {/each}

      <!-- Pinned Notes (kind 10001) -->
      {#if pinnedList}
        <ExpandableListCard
          title={m.dashboard_lists_pinned()}
          count={getEventItemCount(pinnedList)}
          expanded={expandedListId === 'pinned'}
          toggle={() => toggleExpand('pinned', pinnedList)}
        >
          {#snippet icon()}<span class="text-lg">📌</span>{/snippet}
          {#if resolvedEvents.length > 0}
            {@render eventGrid()}
          {/if}
        </ExpandableListCard>
      {/if}

      <!-- Mute List (kind 10000) -->
      {#if muteList}
        {@const mutedThings = parseMutedThings(muteList)}
        {@const totalCount =
          mutedThings.pubkeys.size +
          mutedThings.hashtags.size +
          mutedThings.words.size +
          mutedThings.threads.size}
        <ExpandableListCard
          title={m.dashboard_lists_mute()}
          count={totalCount}
          expanded={expandedListId === 'mute'}
          toggle={() => toggleExpand('mute', null)}
        >
          {#snippet icon()}<span class="text-lg">🔇</span>{/snippet}
          <div class="space-y-3">
            {#if mutedThings.pubkeys.size > 0}
              <div>
                <p class="mb-1 text-sm font-medium text-base-content/60">
                  {m.dashboard_lists_mute_pubkeys()}
                </p>
                {@render profileChips(Array.from(mutedThings.pubkeys).map((p) => ({ pubkey: p })))}
              </div>
            {/if}
            {#if mutedThings.hashtags.size > 0}
              <div>
                <p class="mb-1 text-sm font-medium text-base-content/60">
                  {m.dashboard_lists_mute_hashtags()}
                </p>
                {@render hashtagPills(Array.from(mutedThings.hashtags))}
              </div>
            {/if}
            {#if mutedThings.words.size > 0}
              <div>
                <p class="mb-1 text-sm font-medium text-base-content/60">
                  {m.dashboard_lists_mute_words()}
                </p>
                <div class="flex flex-wrap gap-2">
                  {#each Array.from(mutedThings.words) as word (word)}
                    <span class="badge badge-outline badge-error">{word}</span>
                  {/each}
                </div>
              </div>
            {/if}
            {#if mutedThings.threads.size > 0}
              <div>
                <p class="mb-1 text-sm font-medium text-base-content/60">
                  {m.dashboard_lists_mute_threads()}
                </p>
                <p class="text-sm text-base-content/50">{mutedThings.threads.size} threads</p>
              </div>
            {/if}
          </div>
        </ExpandableListCard>
      {/if}

      <!-- Interests (kind 10015) -->
      {#if interestList}
        {@const tags = getHashtags(interestList)}
        <ExpandableListCard
          title={m.dashboard_lists_interests()}
          count={tags.length}
          expanded={expandedListId === 'interests'}
          toggle={() => toggleExpand('interests', null)}
        >
          {#snippet icon()}<span class="text-lg">💡</span>{/snippet}
          {@render hashtagPills(tags)}
        </ExpandableListCard>
      {/if}

      <!-- Interest Sets (kind 30015) -->
      {#each interestSets as set (set.id)}
        {@const listId = `iset-${set.id}`}
        {@const tags = getHashtags(set)}
        <ExpandableListCard
          title={getSetTitle(set)}
          count={tags.length}
          expanded={expandedListId === listId}
          toggle={() => toggleExpand(listId, null)}
        >
          {#snippet icon()}<span class="text-lg">💡</span>{/snippet}
          {@render hashtagPills(tags)}
        </ExpandableListCard>
      {/each}

      <!-- Follow Sets (kind 30000, excluding d="communities") -->
      {#each followSets as set (set.id)}
        {@const pointers = getProfilePointersFromList(set)}
        {@const listId = `fset-${set.id}`}
        <ExpandableListCard
          title={getSetTitle(set)}
          count={pointers.length}
          countLabel="people"
          expanded={expandedListId === listId}
          toggle={() => toggleExpand(listId, null)}
        >
          {#snippet icon()}<span class="text-lg">👥</span>{/snippet}
          {@render profileChips(pointers)}
        </ExpandableListCard>
      {/each}

      <!-- NIP-65 Relay List (kind 10002) -->
      {#if relayList}
        {@const entries = parseRelayListEvent(relayList)}
        <ExpandableListCard
          title={m.dashboard_lists_relay_list()}
          count={entries.length}
          countLabel="relays"
          expanded={expandedListId === 'relays'}
          toggle={() => toggleExpand('relays', null)}
        >
          {#snippet icon()}<span class="text-lg">🔌</span>{/snippet}
          {@render relayListWithMarkers(entries)}
        </ExpandableListCard>
      {/if}

      <!-- Relay Sets (kind 30002, excluding app-specific) -->
      {#each relaySets as set (set.id)}
        {@const relays = getRelaysFromList(set)}
        {@const listId = `rset-${set.id}`}
        <ExpandableListCard
          title={getSetTitle(set)}
          count={relays.length}
          countLabel="relays"
          expanded={expandedListId === listId}
          toggle={() => toggleExpand(listId, null)}
        >
          {#snippet icon()}<span class="text-lg">🔌</span>{/snippet}
          {@render relayUrlList(relays)}
        </ExpandableListCard>
      {/each}

      <!-- Search Relays (kind 10007) -->
      {#if searchRelayList}
        {@const relays = getRelaysFromList(searchRelayList)}
        <ExpandableListCard
          title={m.dashboard_lists_search_relays()}
          count={relays.length}
          countLabel="relays"
          expanded={expandedListId === 'search-relays'}
          toggle={() => toggleExpand('search-relays', null)}
        >
          {#snippet icon()}<span class="text-lg">🔍</span>{/snippet}
          {@render relayUrlList(relays)}
        </ExpandableListCard>
      {/if}

      <!-- Curation Sets (kind 30004) -->
      {#each curationSets as set (set.id)}
        {@const listId = `cset-${set.id}`}
        <ExpandableListCard
          title={getSetTitle(set)}
          count={getEventItemCount(set)}
          expanded={expandedListId === listId}
          toggle={() => toggleExpand(listId, set)}
        >
          {#snippet icon()}<span class="text-lg">📑</span>{/snippet}
          {#if resolvedEvents.length > 0}
            {@render eventGrid()}
          {/if}
        </ExpandableListCard>
      {/each}
    </div>
  {/if}
</section>
