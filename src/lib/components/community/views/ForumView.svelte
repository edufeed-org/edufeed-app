<!--
  ForumView Component
  Thread list with navigation to deep-linked detail views
  Thread list matches Chateau forum layout: single-column, dividers, bottom action bar
-->

<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import { getPointerForEvent, encodeDecodeResult, getSeenRelays } from 'applesauce-core/helpers';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { timedPool } from '$lib/loaders/base.js';
  import { getCommunikeyRelays, getFallbackRelays } from '$lib/helpers/relay-helper.js';
  import { getCommunityGlobalRelays } from '$lib/helpers/communityRelays.js';
  import { useThreadCommunityLoader } from '$lib/loaders/threads.js';
  import { CommunityThreadModel } from '$lib/models/community-content.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { hexToNpub } from '$lib/helpers/nostrUtils.js';
  import { PlusIcon, SearchIcon } from '$lib/components/icons';
  import ThreadCard from '$lib/components/thread/ThreadCard.svelte';
  import ThreadCreateForm from '$lib/components/thread/ThreadCreateForm.svelte';
  import CommunityContentView from './CommunityContentView.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ communityPubkey: string, communityProfile?: any, canPublish?: boolean }} */
  let { communityPubkey, communityProfile = null, canPublish = true } = $props();

  const getActiveUser = useActiveUser();
  const activeUser = $derived(getActiveUser());

  let showCreateForm = $state(false);
  let searchQuery = $state('');

  // Thread events from model — used to derive IDs for batch comment loader
  let threads = $state(/** @type {any[]} */ ([]));

  // Batch-load commenter profiles for all threads
  let commenterPubkeys = $state(/** @type {string[]} */ ([]));
  const getCommenterProfiles = useProfileMap(() => commenterPubkeys);
  const commenterProfiles = $derived(getCommenterProfiles());

  // Plain Set for O(1) dedup — not reactive, avoids read/write loops in $effect
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- intentionally non-reactive internal tracking
  let seenPubkeys = new Set();

  // Subscribe to thread model directly to track thread IDs for batch comment loading.
  // CommunityContentView also subscribes to this model, but we need our own subscription
  // because {@const} in snippets doesn't re-evaluate reliably when items change.
  $effect(() => {
    commenterPubkeys = [];
    seenPubkeys = new Set();
    threads = [];

    if (!communityPubkey) return;

    const sub = eventStore.model(CommunityThreadModel, communityPubkey).subscribe((loaded) => {
      threads = loaded || [];
    });

    return () => sub.unsubscribe();
  });

  // Batch comment loader: one relay query for all visible threads
  $effect(() => {
    const ids = threads.map((t) => t.id).filter(Boolean);
    if (ids.length === 0) return;

    // Collect seen relays from thread events
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- intentionally non-reactive, local to this $effect
    const seenRelaySet = new Set();
    for (const t of threads) {
      const relays = getSeenRelays(t);
      if (relays) relays.forEach((r) => seenRelaySet.add(r));
    }

    const communityEvent = eventStore.getReplaceable(10222, communityPubkey);
    const communityRelays = getCommunityGlobalRelays(communityEvent);
    /** @type {string[]} */
    const relays = [
      ...new Set([
        ...getCommunikeyRelays(),
        ...communityRelays,
        ...getFallbackRelays(),
        ...seenRelaySet
      ])
    ];
    // Use #E (root scope) to fetch ALL comments including those from clients
    // that only set uppercase E tag (missing lowercase e parent tag)
    const loader = createTimelineLoader(
      timedPool,
      relays,
      { kinds: [1111], '#E': ids, limit: 500 },
      { eventStore }
    );
    const sub = loader().subscribe({
      next: (/** @type {any} */ comment) => {
        if (!seenPubkeys.has(comment.pubkey)) {
          seenPubkeys.add(comment.pubkey);
          commenterPubkeys = [...seenPubkeys];
        }
      }
    });

    return () => sub.unsubscribe();
  });

  /**
   * Filter threads by search query — pure function, used inside snippet
   * @param {any[]} items
   * @returns {any[]}
   */
  function filterThreads(items) {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter((t) => {
      const title =
        t.tags?.find((/** @type {any} */ tag) => tag[0] === 'title')?.[1]?.toLowerCase() || '';
      const content = t.content?.toLowerCase() || '';
      return title.includes(q) || content.includes(q);
    });
  }

  /**
   * Navigate to thread detail view via nevent URL
   * @param {any} thread
   */
  function handleSelectThread(thread) {
    const npub = hexToNpub(communityPubkey);
    if (!npub) return;

    const relays = getSeenRelays(thread);
    const relayHints = relays ? [...relays].slice(0, 3) : [];
    const nevent = encodeDecodeResult(getPointerForEvent(thread, relayHints));
    goto(resolve(`/c/${npub}/${nevent}`));
  }

  /**
   * Navigate to newly created thread
   * @param {any} newThread
   */
  function handleThreadCreated(newThread) {
    handleSelectThread(newThread);
  }
</script>

<!-- Top action bar: Search + Post -->
<div
  class="sticky top-0 z-[55] flex items-center gap-2 border-b border-base-300 bg-base-100 px-4 py-3"
>
  <div class="relative flex-1">
    <SearchIcon class_="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/40" />
    <input
      type="text"
      bind:value={searchQuery}
      placeholder={m.thread_forum_search_placeholder()}
      class="input-bordered input input-sm w-full pl-9"
    />
  </div>

  {#if activeUser && canPublish}
    <button
      class="btn gap-1 btn-sm btn-primary"
      onclick={() => (showCreateForm = true)}
      aria-label={m.thread_forum_new_thread()}
    >
      <PlusIcon class_="h-4 w-4" />
      {m.thread_forum_post()}
    </button>
  {/if}
</div>

<!-- Thread list -->
<CommunityContentView
  {communityPubkey}
  {communityProfile}
  loaderHook={useThreadCommunityLoader}
  model={CommunityThreadModel}
  loadingText={m.community_forum_loading()}
  emptyTitle={m.community_forum_empty_title()}
  emptyDescription={m.community_forum_empty_description()}
  formatCount={(count) => m.community_forum_count({ count })}
  emptyIconPath="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"
>
  {#snippet content(items, authorProfiles)}
    {@const filtered = filterThreads(items)}

    <!-- Single-column thread list with dividers -->
    <div class="divide-y divide-base-300">
      {#each filtered as thread (thread.id)}
        <ThreadCard
          {thread}
          authorProfile={authorProfiles.get(thread.pubkey) || null}
          {commenterProfiles}
          onSelect={handleSelectThread}
        />
      {/each}
      {#if filtered.length === 0 && searchQuery.trim()}
        <div class="py-8 text-center text-base-content/60">
          No threads match "{searchQuery}"
        </div>
      {/if}
    </div>
  {/snippet}
</CommunityContentView>

{#if activeUser && canPublish}
  <ThreadCreateForm
    {communityPubkey}
    {activeUser}
    open={showCreateForm}
    onclose={() => (showCreateForm = false)}
    onCreated={handleThreadCreated}
  />
{/if}
