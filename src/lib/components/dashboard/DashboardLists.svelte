<!--
  DashboardLists — Shows the user's NIP-51 lists.

  Data sourcing is delegated to `personal-lists.svelte.js` which subscribes
  to every list kind enumerated in `$lib/helpers/list-kinds.js`. This file
  is responsible only for the render tree (one section per kind).
-->
<script>
  import * as kinds from 'nostr-tools/kinds';
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import { timedPool } from '$lib/loaders/base.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import {
    getEventPointersFromList,
    getAddressPointersFromList,
    getProfilePointersFromList,
    getRelaysFromList
  } from 'applesauce-common/helpers';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { parseRelayListEvent } from '$lib/services/relay-settings-service.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { getContentEventRoute } from '$lib/helpers/contentNavigation.js';
  import { getFeedCardData } from '$lib/helpers/feedCardData.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import FeedCard from '$lib/components/shared/FeedCard.svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import ExpandableListCard from './ExpandableListCard.svelte';
  import NewListModal from '$lib/components/lists/NewListModal.svelte';
  import { BookmarkIcon, ChevronRightIcon, PlusIcon } from '$lib/components/icons';
  import { encodeEventToNaddr, profileLink } from '$lib/helpers/nostrUtils.js';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';
  import { useList, useAllLists, isListsLoading } from '$lib/stores/personal-lists.svelte.js';
  import { STARTER_PACK_KIND } from '$lib/helpers/list-kinds.js';

  /** @type {{ pubkey: string }} */
  let { pubkey } = $props();

  // --- Data via the generic personal-lists store --------------------------

  const getBookmarkList = useList(kinds.BookmarkList);
  const getPinnedList = useList(kinds.Pinlist);
  const getMuteList = useList(kinds.Mutelist);
  const getRelayList = useList(kinds.RelayList);
  const getSearchRelayList = useList(kinds.SearchRelaysList);
  const getInterestList = useList(kinds.InterestsList);
  const getContactsList = useList(kinds.Contacts);
  const getCommunitiesList = useList(kinds.CommunitiesList);
  const getPublicChatsList = useList(kinds.PublicChatsList);
  const getBlockedRelaysList = useList(kinds.BlockedRelaysList);
  const getDmRelaysList = useList(kinds.DirectMessageRelaysList);
  const getEmojiList = useList(kinds.UserEmojiList);

  const getBookmarkSets = useAllLists(kinds.Bookmarksets);
  const getFollowSets = useAllLists(kinds.Followsets);
  const getCurationSets = useAllLists(kinds.Curationsets);
  const getRelaySets = useAllLists(kinds.Relaysets);
  const getInterestSets = useAllLists(kinds.Interestsets);
  const getEmojiSets = useAllLists(kinds.Emojisets);
  const getStarterPacks = useAllLists(STARTER_PACK_KIND);

  let bookmarkList = $derived(getBookmarkList());
  let pinnedList = $derived(getPinnedList());
  let muteList = $derived(getMuteList());
  let relayList = $derived(getRelayList());
  let searchRelayList = $derived(getSearchRelayList());
  let interestList = $derived(getInterestList());
  let contactsList = $derived(getContactsList());
  let communitiesList = $derived(getCommunitiesList());
  let publicChatsList = $derived(getPublicChatsList());
  let blockedRelaysList = $derived(getBlockedRelaysList());
  let dmRelaysList = $derived(getDmRelaysList());
  let emojiList = $derived(getEmojiList());

  let bookmarkSets = $derived(getBookmarkSets());
  let followSets = $derived(getFollowSets().filter((s) => getSetDTag(s) !== 'communities'));
  let curationSets = $derived(getCurationSets());
  let relaySets = $derived(
    getRelaySets().filter((s) => {
      const dTag = getSetDTag(s);
      const appPrefix = (runtimeConfig.appName || 'Edufeed') + '/';
      return !dTag.startsWith(appPrefix);
    })
  );
  let interestSets = $derived(getInterestSets());
  let emojiSets = $derived(getEmojiSets());
  let starterPacks = $derived(getStarterPacks());

  let isLoading = $derived(isListsLoading());

  /** @type {string | null} */
  let expandedListId = $state(null);
  /** @type {import('nostr-tools').NostrEvent | null} */
  let expandedListEvent = $state(null);

  /** @type {import('nostr-tools').NostrEvent[]} */
  let resolvedEvents = $state.raw([]);

  const getProfiles = useProfileMap(() => resolvedEvents.map((e) => e.pubkey));
  let profiles = $derived(getProfiles());

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
   * Count event references in a list (e + a tags).
   * @param {import('nostr-tools').NostrEvent} event
   * @returns {number}
   */
  function getEventItemCount(event) {
    return getEventPointersFromList(event).length + getAddressPointersFromList(event).length;
  }

  /**
   * @param {import('nostr-tools').NostrEvent} event
   * @returns {string[]}
   */
  function getHashtags(event) {
    return event.tags.filter((t) => t[0] === 't').map((t) => t[1]);
  }

  /**
   * Pure mute list parser.
   * @param {import('nostr-tools').NostrEvent} event
   */
  function parseMutedThings(event) {
    const pubkeys = new Set(event.tags.filter((t) => t[0] === 'p').map((t) => t[1]));
    const hashtags = new Set(event.tags.filter((t) => t[0] === 't').map((t) => t[1]));
    const words = new Set(event.tags.filter((t) => t[0] === 'word').map((t) => t[1]));
    const threads = new Set(event.tags.filter((t) => t[0] === 'e').map((t) => t[1]));
    return { pubkeys, hashtags, words, threads };
  }

  /**
   * Extract {shortcode, url} tuples from a kind-10030/30030 event.
   * @param {import('nostr-tools').NostrEvent} event
   * @returns {Array<{ shortcode: string, url: string }>}
   */
  function parseEmojiTags(event) {
    return event.tags
      .filter((t) => t[0] === 'emoji' && t[1] && t[2])
      .map((t) => ({ shortcode: t[1], url: t[2] }));
  }

  /**
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

    const lookupRelays = getAllLookupRelays();

    if (eventPointers.length > 0) {
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

  let hasAnyLists = $derived(
    bookmarkList !== null ||
      pinnedList !== null ||
      muteList !== null ||
      relayList !== null ||
      searchRelayList !== null ||
      interestList !== null ||
      contactsList !== null ||
      communitiesList !== null ||
      publicChatsList !== null ||
      blockedRelaysList !== null ||
      dmRelaysList !== null ||
      emojiList !== null ||
      bookmarkSets.length > 0 ||
      followSets.length > 0 ||
      curationSets.length > 0 ||
      relaySets.length > 0 ||
      interestSets.length > 0 ||
      emojiSets.length > 0 ||
      starterPacks.length > 0
  );

  // Keep pubkey in scope for future per-user initialization hooks
  $effect(() => {
    void pubkey;
  });

  // New list modal state
  let showNewListModal = $state(false);
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
        {event}
        timestamp={event.created_at}
        onclick={() => navigateToEvent(event)}
      />
    {/each}
  </div>
{/snippet}

{#snippet profileChips(/** @type {Array<{pubkey: string}>} */ pointers)}
  <div class="flex flex-wrap gap-3">
    {#each pointers as pointer (pointer.pubkey)}
      {@const getProfile = useUserProfile(() => pointer.pubkey)}
      {@const profile = getProfile()}
      {@const displayName = getDisplayName(profile) || `${pointer.pubkey.slice(0, 8)}...`}
      <a
        href={resolve(profileLink(pointer.pubkey))}
        class="flex items-center gap-2 rounded-full border border-base-300 bg-base-100 px-3 py-1.5 shadow-sm hover:shadow-md"
      >
        <ProfileAvatar pubkey={pointer.pubkey} size="sm" fallbackType="robohash" />
        <span class="text-sm">{displayName}</span>
      </a>
    {/each}
  </div>
{/snippet}

{#snippet hashtagPills(/** @type {string[]} */ tags)}
  <div class="flex flex-wrap gap-2">
    {#each tags as tag (tag)}
      <span class="badge badge-outline">#{tag}</span>
    {/each}
  </div>
{/snippet}

{#snippet relayUrlList(/** @type {string[]} */ relays)}
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

{#snippet relayListWithMarkers(
  /** @type {Array<{url: string, read?: boolean, write?: boolean}>} */ entries
)}
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

{#snippet addressList(
  /** @type {Array<{kind: number, pubkey: string, identifier: string}>} */ pointers
)}
  <div class="space-y-1">
    {#each pointers as p (`${p.kind}:${p.pubkey}:${p.identifier}`)}
      <div
        class="flex items-center gap-2 rounded border border-base-300 bg-base-100 px-3 py-1.5 font-mono text-xs break-all"
      >
        {p.kind}:{p.pubkey.slice(0, 10)}…:{p.identifier}
      </div>
    {/each}
  </div>
{/snippet}

{#snippet emojiGrid(/** @type {Array<{shortcode: string, url: string}>} */ emojis)}
  <div class="flex flex-wrap gap-3">
    {#each emojis as emoji (emoji.shortcode)}
      <div class="flex items-center gap-2 rounded border border-base-300 bg-base-100 px-2 py-1">
        <ImageWithFallback
          src={emoji.url}
          alt={emoji.shortcode}
          fallbackType="generic"
          class="h-6 w-6 object-contain"
        />
        <span class="font-mono text-xs">:{emoji.shortcode}:</span>
      </div>
    {/each}
  </div>
{/snippet}

{#snippet detailLink(/** @type {import('nostr-tools').NostrEvent} */ event)}
  {@const naddr = encodeEventToNaddr(event)}
  {#if naddr}
    <a
      href={resolve(`/${naddr}`)}
      class="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
    >
      {m.list_view_details()}
      <ChevronRightIcon class_="h-3.5 w-3.5" />
    </a>
  {/if}
{/snippet}

<section data-testid="dashboard-lists">
  <div class="mb-4 flex items-center justify-between">
    <h2 class="text-lg font-bold">{m.dashboard_lists_title()}</h2>
    <button
      class="btn gap-1 btn-sm btn-primary"
      onclick={() => (showNewListModal = true)}
      data-testid="new-list-button"
    >
      <PlusIcon class_="h-4 w-4" />
      {m.dashboard_lists_new()}
    </button>
  </div>

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
      <!-- Contacts / Following (kind 3) — read-only, edit on profile -->
      {#if contactsList}
        {@const pointers = getProfilePointersFromList(contactsList)}
        <a
          href={resolve(profileLink(pubkey))}
          class="flex items-center justify-between rounded-lg border border-base-300 bg-base-100 p-3 hover:bg-base-200"
          data-testid="list-contacts"
        >
          <div class="flex items-center gap-3">
            <span class="text-lg">👤</span>
            <div>
              <div class="font-medium">{m.dashboard_lists_contacts()}</div>
              <div class="text-xs text-base-content/60">
                {pointers.length} · {m.dashboard_lists_contacts_hint()}
              </div>
            </div>
          </div>
          <ChevronRightIcon class_="h-4 w-4 text-base-content/40" />
        </a>
      {/if}

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
          {@render detailLink(bookmarkList)}
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
          {@render detailLink(set)}
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
          {@render detailLink(pinnedList)}
        </ExpandableListCard>
      {/if}

      <!-- Public Chats (kind 10005) -->
      {#if publicChatsList}
        <ExpandableListCard
          title={m.dashboard_lists_public_chats()}
          count={getEventItemCount(publicChatsList)}
          expanded={expandedListId === 'public-chats'}
          toggle={() => toggleExpand('public-chats', publicChatsList)}
        >
          {#snippet icon()}<span class="text-lg">💬</span>{/snippet}
          {#if resolvedEvents.length > 0}
            {@render eventGrid()}
          {/if}
          {@render detailLink(publicChatsList)}
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
          {@render detailLink(muteList)}
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
          {@render detailLink(interestList)}
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
          {@render detailLink(set)}
        </ExpandableListCard>
      {/each}

      <!-- Communities (kind 10004) -->
      {#if communitiesList}
        {@const pointers = getAddressPointersFromList(communitiesList)}
        <ExpandableListCard
          title={m.dashboard_lists_communities()}
          count={pointers.length}
          expanded={expandedListId === 'communities'}
          toggle={() => toggleExpand('communities', null)}
        >
          {#snippet icon()}<span class="text-lg">🏘️</span>{/snippet}
          {@render addressList(pointers)}
          {@render detailLink(communitiesList)}
        </ExpandableListCard>
      {/if}

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
          {@render detailLink(set)}
        </ExpandableListCard>
      {/each}

      <!-- Starter Packs (kind 39089) -->
      {#each starterPacks as set (set.id)}
        {@const pointers = getProfilePointersFromList(set)}
        {@const listId = `sp-${set.id}`}
        <ExpandableListCard
          title={getSetTitle(set)}
          count={pointers.length}
          countLabel="people"
          expanded={expandedListId === listId}
          toggle={() => toggleExpand(listId, null)}
        >
          {#snippet icon()}<span class="text-lg">🎁</span>{/snippet}
          {@render profileChips(pointers)}
          {@render detailLink(set)}
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
          {@render detailLink(relayList)}
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
          {@render detailLink(set)}
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
          {@render detailLink(searchRelayList)}
        </ExpandableListCard>
      {/if}

      <!-- Blocked Relays (kind 10006) -->
      {#if blockedRelaysList}
        {@const relays = getRelaysFromList(blockedRelaysList)}
        <ExpandableListCard
          title={m.dashboard_lists_blocked_relays()}
          count={relays.length}
          countLabel="relays"
          expanded={expandedListId === 'blocked-relays'}
          toggle={() => toggleExpand('blocked-relays', null)}
        >
          {#snippet icon()}<span class="text-lg">🚫</span>{/snippet}
          {@render relayUrlList(relays)}
          {@render detailLink(blockedRelaysList)}
        </ExpandableListCard>
      {/if}

      <!-- DM Relays (kind 10050) -->
      {#if dmRelaysList}
        {@const relays = getRelaysFromList(dmRelaysList)}
        <ExpandableListCard
          title={m.dashboard_lists_dm_relays()}
          count={relays.length}
          countLabel="relays"
          expanded={expandedListId === 'dm-relays'}
          toggle={() => toggleExpand('dm-relays', null)}
        >
          {#snippet icon()}<span class="text-lg">✉️</span>{/snippet}
          {@render relayUrlList(relays)}
          {@render detailLink(dmRelaysList)}
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
          {@render detailLink(set)}
        </ExpandableListCard>
      {/each}

      <!-- Emoji List (kind 10030) -->
      {#if emojiList}
        {@const emojis = parseEmojiTags(emojiList)}
        <ExpandableListCard
          title={m.dashboard_lists_emoji()}
          count={emojis.length}
          expanded={expandedListId === 'emoji'}
          toggle={() => toggleExpand('emoji', null)}
        >
          {#snippet icon()}<span class="text-lg">😀</span>{/snippet}
          {@render emojiGrid(emojis)}
          {@render detailLink(emojiList)}
        </ExpandableListCard>
      {/if}

      <!-- Emoji Sets (kind 30030) -->
      {#each emojiSets as set (set.id)}
        {@const emojis = parseEmojiTags(set)}
        {@const listId = `eset-${set.id}`}
        <ExpandableListCard
          title={getSetTitle(set)}
          count={emojis.length}
          expanded={expandedListId === listId}
          toggle={() => toggleExpand(listId, null)}
        >
          {#snippet icon()}<span class="text-lg">😀</span>{/snippet}
          {@render emojiGrid(emojis)}
          {@render detailLink(set)}
        </ExpandableListCard>
      {/each}
    </div>
  {/if}
</section>

<NewListModal open={showNewListModal} onclose={() => (showNewListModal = false)} />
