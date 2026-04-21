<script>
  import { resolve } from '$app/paths';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import CommentInput from './CommentInput.svelte';
  import { ChatIcon, TrashIcon, CopyIcon } from '$lib/components/icons';
  import NostrContentRenderer from '$lib/components/shared/NostrContentRenderer.svelte';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import { getPlainTextExcerpt } from '$lib/helpers/commentThreading.js';
  import ReactionBar from '$lib/components/reactions/ReactionBar.svelte';
  import { deleteComment } from '$lib/helpers/comments.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { nip19 } from 'nostr-tools';
  import { getSeenRelays } from 'applesauce-core/helpers';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} CommentProps
   * @property {any} comment - The comment event
   * @property {any} rootEvent - The root event being commented on
   * @property {any} activeUser - The currently active user
   * @property {number} [depth] - Nesting depth (0 for top-level)
   * @property {(event: any) => void} [onCommentPosted] - Callback when reply is posted
   * @property {string} [communityPubkey] - Community hex pubkey for #h tag on comments
   */

  /** @type {CommentProps} */
  let {
    comment,
    rootEvent,
    activeUser,
    depth = 0,
    onCommentPosted = (/** @type {any} */ _event) => {},
    communityPubkey = undefined
  } = $props();

  let showReplyForm = $state(false);
  let isDeleting = $state(false);

  // Get author profile
  const getUserProfile = useUserProfile(() => comment.pubkey);
  let authorProfile = $derived(getUserProfile());

  // Get parent author profile (for reply context header)
  const getParentProfile = useUserProfile(() => comment.parentComment?.pubkey);
  let parentProfile = $derived(depth > 0 && comment.parentComment ? getParentProfile() : null);
  let parentName = $derived(
    parentProfile ? getDisplayName(parentProfile) : comment.parentComment?.pubkey?.slice(0, 8)
  );
  let parentExcerpt = $derived(getPlainTextExcerpt(comment.parentComment?.content, 60));

  // Check if user can delete this comment (must be the author)
  let canDelete = $derived(activeUser && comment.pubkey === activeUser.pubkey);

  /**
   * Copy a deep-link URL for this comment to the clipboard
   */
  function copyCommentLink() {
    const relays = getSeenRelays(comment);
    const nevent = nip19.neventEncode({
      id: comment.id,
      relays: relays ? [...relays].slice(0, 3) : []
    });
    const url = `${window.location.origin}/${nevent}`;
    navigator.clipboard.writeText(url).then(() => showToast(m.comments_link_copied(), 'success'));
  }

  /**
   * Handle reply button click
   */
  function handleReplyClick() {
    showReplyForm = !showReplyForm;
  }

  /**
   * Handle reply posted
   */
  function handleReplyPosted(/** @type {any} */ event) {
    showReplyForm = false;
    onCommentPosted(event);
  }

  /**
   * Handle cancel reply
   */
  function handleCancelReply() {
    showReplyForm = false;
  }

  /**
   * Handle delete comment
   */
  async function handleDelete() {
    if (isDeleting || !canDelete) return;

    // Confirm deletion
    if (!confirm(m.comments_delete_confirm())) {
      return;
    }

    isDeleting = true;
    try {
      await deleteComment(comment, {
        relays: runtimeConfig.fallbackRelays || []
      });
      showToast(m.comments_delete_success(), 'success');
    } catch (error) {
      console.error('Failed to delete comment:', error);
      showToast(m.comments_delete_error(), 'error');
    } finally {
      isDeleting = false;
    }
  }

  /**
   * Scroll to parent comment
   */
  function scrollToParent() {
    if (!comment.parentComment) return;
    const parentEl = document.querySelector(`[data-comment-id="${comment.parentComment.id}"]`);
    if (parentEl) {
      parentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      parentEl.classList.add('comment-highlight');
      setTimeout(() => parentEl.classList.remove('comment-highlight'), 2000);
    }
  }
</script>

<div class="comment-wrapper" data-testid="comment" data-comment-id={comment.id}>
  <div class="rounded-lg border border-base-300 bg-base-100 p-4">
    <!-- Reply Context Header -->
    {#if depth > 0 && comment.parentComment}
      <button
        class="mb-2 flex cursor-pointer items-center gap-1 text-xs text-base-content/50 transition-colors hover:text-base-content/70"
        onclick={scrollToParent}
        title={m.comments_replying_to({ name: parentName || '...' })}
      >
        <span>↩</span>
        <span class="font-medium">{m.comments_replying_to({ name: parentName || '...' })}</span>
        {#if parentExcerpt}
          <span class="max-w-xs truncate italic">"{parentExcerpt}"</span>
        {/if}
      </button>
    {/if}

    <!-- Comment Header -->
    <div class="mb-3 flex items-start gap-3">
      <ProfileAvatar
        pubkey={comment.pubkey}
        profile={authorProfile}
        size="md"
        linkToProfile
        class="flex-shrink-0"
      />

      <!-- Author & Timestamp -->
      <div class="flex-1">
        <div class="flex items-baseline gap-2">
          <a href={resolve(`/p/${comment.pubkey}`)} class="font-semibold hover:underline">
            {getDisplayName(authorProfile) ||
              `${comment.pubkey.slice(0, 8)}...${comment.pubkey.slice(-4)}`}
          </a>
          <span class="text-xs text-base-content/50">
            {formatRelativeTime(comment.created_at)}
          </span>
        </div>

        <!-- Comment Content -->
        <NostrContentRenderer
          event={comment}
          class="prose-sm mt-2 max-w-none text-base-content/80"
        />

        <!-- Actions -->
        <div class="mt-3 flex flex-wrap items-center gap-1">
          {#if activeUser}
            <button
              class="btn gap-1 btn-ghost btn-xs"
              onclick={handleReplyClick}
              class:btn-active={showReplyForm}
              data-testid="comment-reply-btn"
            >
              <ChatIcon class_="w-3.5 h-3.5" />
              {m.comments_reply_button()}
            </button>
          {/if}
          <ReactionBar event={comment} lazy />
          <button
            class="btn btn-ghost btn-xs"
            onclick={copyCommentLink}
            title={m.comments_copy_link()}
            data-testid="comment-copy-link-btn"
          >
            <CopyIcon class_="w-3.5 h-3.5" />
          </button>
          {#if canDelete}
            <button
              class="btn text-error btn-ghost btn-xs"
              onclick={handleDelete}
              disabled={isDeleting}
              data-testid="comment-delete-btn"
            >
              <TrashIcon class="h-3.5 w-3.5" />
            </button>
          {/if}
        </div>
      </div>
    </div>

    <!-- Reply Form -->
    {#if showReplyForm && activeUser}
      <div class="mt-4 border-t border-base-300 pt-4">
        <CommentInput
          {rootEvent}
          parentItem={comment}
          {activeUser}
          placeholder={m.comments_reply_placeholder()}
          onCommentPosted={handleReplyPosted}
          onCancel={handleCancelReply}
          autoFocus={true}
          {communityPubkey}
        />
      </div>
    {/if}
  </div>
</div>

<style>
  .comment-wrapper {
    position: relative;
  }

  :global(.comment-highlight) {
    animation: highlight-fade 2s ease-out;
  }

  @keyframes highlight-fade {
    0% {
      background-color: oklch(0.9 0.05 250 / 0.3);
    }
    100% {
      background-color: transparent;
    }
  }
</style>
