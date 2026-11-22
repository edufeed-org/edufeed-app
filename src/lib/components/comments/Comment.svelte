<script>
  import { resolve } from '$app/paths';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import CommentInput from './CommentInput.svelte';
  import { ChatIcon, ReplyIcon } from '$lib/components/icons';
  import EventContextMenu from '$lib/components/shared/EventContextMenu.svelte';
  import NostrContentRenderer from '$lib/components/shared/NostrContentRenderer.svelte';
  import LinkPreviewList from '$lib/components/shared/LinkPreviewList.svelte';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import { getPlainTextExcerpt } from '$lib/helpers/commentThreading.js';
  import ReactionBar from '$lib/components/reactions/ReactionBar.svelte';
  import { deleteComment } from '$lib/helpers/comments.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { profileLink } from '$lib/helpers/nostrUtils.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} CommentProps
   * @property {any} comment - The comment event
   * @property {any} rootEvent - The root event being commented on
   * @property {any} activeUser - The currently active user
   * @property {number} [depth] - Nesting depth (0 for top-level)
   * @property {any} [parentComment] - The comment this one answers (undefined for top-level)
   * @property {{ label: string, onclick: () => void, testid: string, expanded?: boolean }} [repliesAction]
   *   Right-aligned replies control in the actions row (show / hide / continue thread), owned by
   *   CommentThread; `expanded` only for the show/hide toggle
   * @property {(event: any) => void} [onCommentPosted] - Callback when reply is posted
   * @property {string} [communityPubkey] - Community hex pubkey for #h tag on comments
   */

  /** @type {CommentProps} */
  let {
    comment,
    rootEvent,
    activeUser,
    depth = 0,
    parentComment = undefined,
    repliesAction = undefined,
    onCommentPosted = (/** @type {any} */ _event) => {},
    communityPubkey = undefined
  } = $props();

  let showReplyForm = $state(false);

  // Get author profile
  const getUserProfile = useUserProfile(() => comment.pubkey);
  let authorProfile = $derived(getUserProfile());

  // Parent author (for the reply-context chip)
  const getParentProfile = useUserProfile(() => parentComment?.pubkey);
  let parentProfile = $derived(depth > 0 && parentComment ? getParentProfile() : null);
  let parentName = $derived(
    (parentProfile && getDisplayName(parentProfile)) || parentComment?.pubkey?.slice(0, 8)
  );
  let parentExcerpt = $derived(getPlainTextExcerpt(parentComment?.content, 60));

  // Check if user can delete this comment (must be the author)
  let canDelete = $derived(activeUser && comment.pubkey === activeUser.pubkey);

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

  // EventContextMenu confirms first and keeps its dialog open on a throw.
  async function handleDelete() {
    try {
      await deleteComment(comment, { relays: runtimeConfig.fallbackRelays || [] });
      showToast(m.comments_delete_success(), 'success');
    } catch (error) {
      console.error('Failed to delete comment:', error);
      showToast(m.comments_delete_error(), 'error');
      throw error;
    }
  }

  /**
   * Scroll to parent comment
   */
  function scrollToParent() {
    if (!parentComment) return;
    const parentEl = document.querySelector(`[data-comment-id="${parentComment.id}"]`);
    if (parentEl) {
      parentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      parentEl.classList.add('comment-highlight');
      setTimeout(() => parentEl.classList.remove('comment-highlight'), 2000);
    }
  }
</script>

<div class="comment-wrapper" data-testid="comment" data-comment-id={comment.id}>
  <div class="flex items-start gap-3 border-t border-base-content/10 py-4">
    <ProfileAvatar
      pubkey={comment.pubkey}
      profile={authorProfile}
      size={depth > 0 ? 'sm' : 'md'}
      linkToProfile
      class="flex-shrink-0"
    />

    <div class="flex min-w-0 flex-1 flex-col gap-1.5">
      <div class="flex items-baseline gap-2">
        <a href={resolve(profileLink(comment.pubkey))} class="font-semibold hover:underline">
          {getDisplayName(authorProfile) ||
            `${comment.pubkey.slice(0, 8)}...${comment.pubkey.slice(-4)}`}
        </a>
        <span class="text-xs text-base-content/60">
          {formatRelativeTime(comment.created_at)}
        </span>
        <div class="ml-auto self-center">
          <EventContextMenu event={comment} onDelete={canDelete ? handleDelete : undefined} />
        </div>
      </div>

      <!-- Reply context: the visual indent stops after one step on phones and two on
           wider screens (see CommentThread); from there the chip names the parent. -->
      {#if depth > 0 && parentComment}
        <button
          class="flex max-w-full items-center gap-1.5 self-start rounded-lg bg-base-200 px-2.5 py-1 text-xs text-base-content/60 hover:text-base-content {depth <
          2
            ? 'sm:hidden'
            : ''}"
          onclick={scrollToParent}
          title={m.comments_replying_to({ name: parentName || '...' })}
          data-testid="comment-parent-chip"
        >
          <ReplyIcon class_="h-3.5 w-3.5 shrink-0" />
          <span class="min-w-0 truncate">
            <span class="font-semibold text-base-content">{parentName}</span>
            {#if parentExcerpt}
              · {parentExcerpt}
            {/if}
          </span>
        </button>
      {/if}

      <NostrContentRenderer event={comment} class="prose-sm max-w-none text-base-content/80" />

      <LinkPreviewList event={comment} />

      <!-- Actions -->
      <div class="mt-1 flex flex-wrap items-center gap-1 text-base-content/60">
        {#if activeUser}
          <button
            class="btn gap-1 px-2 btn-ghost btn-sm"
            onclick={handleReplyClick}
            class:btn-active={showReplyForm}
            data-testid="comment-reply-btn"
          >
            <ChatIcon class_="w-3.5 h-3.5" />
            {m.comments_reply_button()}
          </button>
        {/if}
        <ReactionBar event={comment} lazy />
        {#if repliesAction}
          <button
            class="btn ml-auto px-2 font-medium btn-ghost btn-sm"
            onclick={repliesAction.onclick}
            aria-expanded={repliesAction.expanded}
            data-testid={repliesAction.testid}
          >
            {repliesAction.label}
          </button>
        {/if}
      </div>

      <!-- Reply Form -->
      {#if showReplyForm && activeUser}
        <div class="mt-2">
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
      background-color: color-mix(in oklch, var(--color-accent) 25%, transparent);
    }
    100% {
      background-color: transparent;
    }
  }
</style>
