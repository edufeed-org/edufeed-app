<script>
  import { resolve } from '$app/paths';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { RepliesModel } from 'applesauce-common/models';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import { hexToNpub } from '$lib/helpers/nostrUtils';
  import { ChatIcon, RepostIcon, LightningIcon, BookmarkIcon } from '$lib/components/icons';
  import ReactionBar from '$lib/components/reactions/ReactionBar.svelte';
  import NostrContentRenderer from '$lib/components/shared/NostrContentRenderer.svelte';
  import CommentList from '$lib/components/comments/CommentList.svelte';
  import { createCommentLoaderForEvent } from '$lib/loaders/comments.js';
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

  // Fetch comments from relays + subscribe to RepliesModel for reactive counts
  $effect(() => {
    if (!note?.id) return;

    // Loader: fetch from relays → populates eventStore
    const loader = createCommentLoaderForEvent(note, extraRelays);
    const loaderSub = loader().subscribe();

    // Model: reactive subscription using RepliesModel (handles NIP-10 + NIP-22)
    const modelSub = eventStore.model(RepliesModel, note).subscribe((replies) => {
      commentCount = (replies || []).length;
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });
</script>

<div class="rounded-lg border border-base-300 bg-base-100 p-4">
  <div class="flex items-start gap-3">
    <!-- Profile Picture -->
    <div class="flex-shrink-0">
      <ProfileAvatar
        pubkey={note.pubkey}
        profile={effectiveProfile}
        size="md"
        linkToProfile
        fallbackType="robohash"
      />
    </div>

    <!-- Note Content -->
    <div class="min-w-0 flex-1">
      <!-- Header -->
      <div class="mb-2 flex items-center gap-2">
        <a href={profileHref} class="font-medium text-base-content hover:underline">
          {getDisplayName(effectiveProfile) ||
            `${note.pubkey.slice(0, 8)}...${note.pubkey.slice(-4)}`}
        </a>
        <span class="text-sm text-base-content/50">· {formatRelativeTime(note.created_at)}</span>
      </div>

      <!-- Note Text -->
      <div class="mb-3 text-base-content/80">
        <NostrContentRenderer event={note} />
      </div>

      <!-- Actions -->
      <div class="flex flex-wrap items-center gap-1">
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
        <button class="btn btn-ghost btn-sm">
          <BookmarkIcon class_="w-4 h-4" />
        </button>
      </div>
    </div>
  </div>

  {#if showComments}
    <div class="mt-3 border-t border-base-300 pt-3">
      <CommentList rootEvent={note} {activeUser} {communityPubkey} {extraRelays} />
    </div>
  {/if}
</div>
