<script>
  import { resolve } from '$app/paths';
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { TimelineModel } from 'applesauce-core/models';
  import { debounceTime } from 'rxjs';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import { hexToNpub } from '$lib/helpers/nostrUtils';
  import { ChatIcon, RepostIcon, LightningIcon, BookmarkIcon } from '$lib/components/icons';
  import ReactionBar from '$lib/components/reactions/ReactionBar.svelte';
  import NostrContentRenderer from '$lib/components/shared/NostrContentRenderer.svelte';
  import CommentList from '$lib/components/comments/CommentList.svelte';
  import { createCommentLoaderForEvent } from '$lib/loaders/comments.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ note: any, authorProfile?: any, activeUser?: any, communityPubkey?: string, extraRelays?: string[] }} */
  let {
    note,
    authorProfile = null,
    activeUser = null,
    communityPubkey = undefined,
    extraRelays = undefined
  } = $props();

  let showComments = $state(false);
  let commentCount = $state(0);
  let profileHref = $derived(resolve(`/p/${hexToNpub(note.pubkey) || note.pubkey}`));

  // Eagerly fetch comments so counts are visible before expanding
  $effect(() => {
    if (!note?.id) return;
    const loader = createCommentLoaderForEvent(note, extraRelays);
    const sub = loader().subscribe();
    return () => sub.unsubscribe();
  });

  $effect(() => {
    if (!note?.id) return;

    let nip22Comments = [];
    let nip10Replies = [];

    // NIP-22 comments (kind 1111 with uppercase #E tag)
    const nip22Sub = eventStore
      .model(TimelineModel, { kinds: [1111], '#E': [note.id] })
      .pipe(debounceTime(100))
      .subscribe((comments) => {
        nip22Comments = comments || [];
        commentCount = nip22Comments.length + nip10Replies.length;
      });

    // NIP-10 replies (kind 1 with lowercase #e tag) — only for kind 1 notes
    /** @type {import('rxjs').Subscription | undefined} */
    let nip10Sub;
    if (note.kind === 1) {
      nip10Sub = eventStore
        .model(TimelineModel, { kinds: [1], '#e': [note.id] })
        .pipe(debounceTime(100))
        .subscribe((replies) => {
          nip10Replies = replies || [];
          commentCount = nip22Comments.length + nip10Replies.length;
        });
    }

    return () => {
      nip22Sub.unsubscribe();
      nip10Sub?.unsubscribe();
    };
  });
</script>

<div class="rounded-lg border border-base-300 bg-base-100 p-4">
  <div class="flex items-start gap-3">
    <!-- Profile Picture -->
    <a href={profileHref} class="h-10 w-10 flex-shrink-0 overflow-hidden rounded-full">
      <img
        src={getProfilePicture(authorProfile) || `https://robohash.org/${note.pubkey}`}
        alt="Profile"
        class="h-full w-full object-cover"
      />
    </a>

    <!-- Note Content -->
    <div class="min-w-0 flex-1">
      <!-- Header -->
      <div class="mb-2 flex items-center gap-2">
        <a href={profileHref} class="font-medium text-base-content hover:underline">
          {getDisplayName(authorProfile) || `${note.pubkey.slice(0, 8)}...${note.pubkey.slice(-4)}`}
        </a>
        <span class="text-sm text-base-content/50">· {formatRelativeTime(note.created_at)}</span>
      </div>

      <!-- Note Text -->
      <div class="mb-3 text-base-content/80">
        <NostrContentRenderer event={note} />
      </div>

      <!-- Reactions -->
      <div class="mb-3">
        <ReactionBar event={note} />
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-6 text-sm text-base-content/50">
        <button
          class="flex items-center gap-1 transition-colors hover:text-primary {showComments
            ? 'text-primary'
            : ''}"
          onclick={() => (showComments = !showComments)}
        >
          <ChatIcon class_="w-4 h-4" />
          <span class="text-xs"
            >{showComments
              ? m.comments_hide()
              : commentCount > 0
                ? commentCount === 1
                  ? m.comments_count_one()
                  : m.comments_count_other({ count: commentCount })
                : m.comments_show()}</span
          >
        </button>
        <button class="flex items-center gap-1 transition-colors hover:text-primary">
          <RepostIcon class_="w-4 h-4" />
        </button>
        <button class="flex items-center gap-1 transition-colors hover:text-primary">
          <LightningIcon class_="w-4 h-4" />
        </button>
        <button class="flex items-center gap-1 transition-colors hover:text-primary">
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
