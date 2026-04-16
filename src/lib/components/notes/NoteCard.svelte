<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getDisplayName, getSeenRelays } from 'applesauce-core/helpers';
  import { nip19 } from 'nostr-tools';
  import { RepliesModel } from 'applesauce-common/models';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import { hexToNpub } from '$lib/helpers/nostrUtils';
  import { ChatIcon, RepostIcon, LightningIcon } from '$lib/components/icons';
  import BookmarkButton from '$lib/components/bookmarks/BookmarkButton.svelte';
  import ReactionBar from '$lib/components/reactions/ReactionBar.svelte';
  import NostrContentRenderer from '$lib/components/shared/NostrContentRenderer.svelte';
  import CommentList from '$lib/components/comments/CommentList.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';

  /** @type {{ note: any, authorProfile?: any, activeUser?: any, communityPubkey?: string, extraRelays?: string[] }} */
  let {
    note,
    authorProfile = null,
    activeUser = null,
    communityPubkey = undefined,
    extraRelays = undefined
  } = $props();

  // Load profile internally when none provided via prop
  const getInternalProfile = useUserProfile(() => (authorProfile ? null : note.pubkey));
  const effectiveProfile = $derived(authorProfile ?? getInternalProfile());

  let showComments = $state(false);
  let commentCount = $state(0);
  let profileHref = $derived(resolve(`/p/${hexToNpub(note.pubkey) || note.pubkey}`));

  // Generate nevent for navigation — route directly to community context when available
  const neventHref = $derived.by(() => {
    const relayHints = getSeenRelays(note);
    const relays = relayHints ? Array.from(relayHints).slice(0, 3) : [];
    const nevent = nip19.neventEncode({ id: note.id, relays, author: note.pubkey });

    // Route to community-scoped detail when community context is known
    const hPubkey =
      communityPubkey || note.tags?.find((/** @type {string[]} */ t) => t[0] === 'h')?.[1];
    if (hPubkey) {
      const npub = hexToNpub(hPubkey);
      if (npub) return resolve(`/c/${npub}/${nevent}`);
    }
    // Stay within the /c/ layout to avoid slow layout boundary crossing
    return resolve(`/c/${nevent}`);
  });

  /**
   * @param {MouseEvent} e
   */
  function handleCardClick(e) {
    if (e.target instanceof HTMLElement && e.target.closest('button, a')) return;
    goto(neventHref);
  }

  /**
   * @param {KeyboardEvent} e
   */
  function handleKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goto(neventHref);
    }
  }

  // Subscribe to RepliesModel for cached comment counts (no relay fetching).
  // CommentList handles relay fetching when the user expands comments.
  $effect(() => {
    if (!note?.id) return;

    const modelSub = eventStore.model(RepliesModel, note).subscribe((replies) => {
      commentCount = (replies || []).length;
    });

    return () => modelSub.unsubscribe();
  });
</script>

<div
  class="cursor-pointer rounded-lg border border-base-300 bg-base-100 p-4 shadow-sm transition-shadow hover:shadow-md"
  role="button"
  tabindex="0"
  onclick={handleCardClick}
  onkeydown={handleKeydown}
>
  <!-- Author Header -->
  <div class="mb-3 flex items-center gap-3">
    <ProfileAvatar
      pubkey={note.pubkey}
      profile={effectiveProfile}
      size="md"
      linkToProfile
      showHoverCard
      fallbackType="robohash"
    />
    <div class="min-w-0 flex-1">
      <a href={profileHref} class="truncate font-medium text-base-content hover:underline">
        {getDisplayName(effectiveProfile) ||
          `${note.pubkey.slice(0, 8)}...${note.pubkey.slice(-4)}`}
      </a>
      <div class="text-sm text-base-content/60">
        {formatRelativeTime(note.created_at)}
      </div>
    </div>
  </div>

  <!-- Note Content -->
  <div class="mb-3 text-base-content/80">
    <NostrContentRenderer event={note} />
  </div>

  <!-- Actions -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="flex flex-wrap items-center gap-1 border-t border-base-300 pt-3"
    onclick={(e) => e.stopPropagation()}
  >
    <button
      class="btn gap-1 btn-ghost btn-sm {showComments ? 'text-primary' : ''}"
      onclick={() => (showComments = !showComments)}
    >
      <ChatIcon class_="w-4 h-4" />
      {#if commentCount > 0}
        <span class="text-xs">{commentCount}</span>
      {/if}
    </button>
    <button class="btn btn-ghost btn-sm">
      <RepostIcon class_="w-4 h-4" />
    </button>
    <ReactionBar event={note} />
    <button class="btn btn-ghost btn-sm">
      <LightningIcon class_="w-4 h-4" />
    </button>
    <BookmarkButton event={note} />
  </div>

  {#if showComments}
    <div class="mt-3 border-t border-base-300 pt-3">
      <CommentList rootEvent={note} {activeUser} {communityPubkey} {extraRelays} />
    </div>
  {/if}
</div>
