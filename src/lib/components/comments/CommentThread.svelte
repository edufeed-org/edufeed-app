<script>
  import Comment from './Comment.svelte';
  import CommentThread from './CommentThread.svelte';
  import { countComments } from '$lib/helpers/commentThreading.js';
  import { ChatIcon } from '$lib/components/icons';
  import { generateAuthorColor } from '$lib/helpers/nostrUtils.js';
  import * as m from '$lib/paraglide/messages';

  /** Max visual nesting depth before showing "Continue thread" */
  const MAX_NESTING_DEPTH = 3;

  /**
   * @typedef {Object} CommentThreadProps
   * @property {any} comment - The comment with nested replies
   * @property {any} rootEvent - The root event being commented on
   * @property {any} activeUser - The currently active user
   * @property {number} [depth] - Current nesting depth
   * @property {number} [maxDepth] - Max depth before showing "Continue thread"
   * @property {boolean} [collapsedReplies] - When true, replies start collapsed
   * @property {Set<string>} [expandedIds] - IDs to force-expand (after back navigation)
   * @property {(commentId: string) => void} [onFocusThread] - Callback to focus on a subtree
   * @property {(event: any) => void} [onCommentPosted] - Callback when new comment is posted
   * @property {string} [communityPubkey] - Community hex pubkey for #h tag on comments
   */

  /** @type {CommentThreadProps} */
  let {
    comment,
    rootEvent,
    activeUser,
    depth = 0,
    maxDepth = MAX_NESTING_DEPTH,
    collapsedReplies = false,
    expandedIds = new Set(),
    onFocusThread,
    onCommentPosted = (/** @type {any} */ _event) => {},
    communityPubkey = undefined
  } = $props();

  let expanded = $state(false);

  // Force-expand when this comment is in the expandedIds set (after back navigation)
  $effect(() => {
    if (expandedIds.has(comment.id)) {
      expanded = true;
    }
  });

  let authorColor = $derived(generateAuthorColor(comment.pubkey));
  let hasReplies = $derived(comment.replies && comment.replies.length > 0);
  let replyCount = $derived(hasReplies ? countComments(comment.replies) : 0);
  let shouldCollapse = $derived(collapsedReplies && hasReplies && !expanded);
  let shouldShowContinueThread = $derived(hasReplies && depth >= maxDepth && onFocusThread);
</script>

<div class="comment-thread">
  <!-- Render the comment -->
  <Comment {comment} {rootEvent} {activeUser} {depth} {onCommentPosted} {communityPubkey} />

  <!-- Recursively render replies -->
  {#if hasReplies}
    {#if shouldShowContinueThread}
      <!-- Depth limit: terminal L-bend connector + button -->
      <div style="position: relative; margin-left: 20px; padding-left: 10px; margin-top: 2px;">
        <div
          style="position: absolute; left: 0; top: 0; height: 50%; width: 10px; border-left: 2px solid {authorColor}; border-bottom: 2px solid {authorColor}; border-bottom-left-radius: 8px;"
        ></div>
        <button
          class="btn mt-1 gap-1 text-base-content/60 btn-ghost btn-sm"
          onclick={() => onFocusThread?.(comment.id)}
          data-testid="continue-thread-btn"
        >
          <ChatIcon class_="w-4 h-4" />
          {replyCount === 1
            ? m.comments_continue_thread_singular()
            : m.comments_continue_thread({ count: replyCount })}
        </button>
      </div>
    {:else if shouldCollapse}
      <!-- Collapsed: terminal L-bend connector + button -->
      <div style="position: relative; margin-left: 20px; padding-left: 10px; margin-top: 2px;">
        <div
          style="position: absolute; left: 0; top: 0; height: 50%; width: 10px; border-left: 2px solid {authorColor}; border-bottom: 2px solid {authorColor}; border-bottom-left-radius: 8px;"
        ></div>
        <button
          class="btn mt-1 gap-1 text-base-content/60 btn-ghost btn-sm"
          onclick={() => (expanded = true)}
          data-testid="expand-replies-btn"
        >
          <ChatIcon class_="w-4 h-4" />
          {replyCount === 1
            ? m.comments_view_reply()
            : m.comments_view_replies({ count: replyCount })}
        </button>
      </div>
    {:else}
      <!-- Expanded replies with tree-style connectors -->
      <div class="replies" style="margin-left: 20px; margin-top: 2px;">
        {#if collapsedReplies && expanded}
          <button
            class="btn text-base-content/50 btn-ghost btn-xs"
            style="margin-left: 10px;"
            onclick={() => (expanded = false)}
            data-testid="collapse-replies-btn"
          >
            {m.comments_hide_replies()}
          </button>
        {/if}
        {#each comment.replies as reply, i (reply.id)}
          {@const isLast = i === comment.replies.length - 1}
          <div style="position: relative; padding-left: 10px;">
            {#if isLast}
              <!-- └ connector: L-bend for last child -->
              <div
                style="position: absolute; left: 0; top: 0; height: 36px; width: 10px; border-left: 2px solid {authorColor}; border-bottom: 2px solid {authorColor}; border-bottom-left-radius: 8px;"
              ></div>
            {:else}
              <!-- ├ connector: vertical line + horizontal stub -->
              <div
                style="position: absolute; left: 0; top: 0; bottom: 0; border-left: 2px solid {authorColor};"
              ></div>
              <div
                style="position: absolute; left: 0; top: 36px; width: 10px; border-top: 2px solid {authorColor};"
              ></div>
            {/if}
            <CommentThread
              comment={reply}
              {rootEvent}
              {activeUser}
              depth={depth + 1}
              {maxDepth}
              {collapsedReplies}
              {expandedIds}
              {onFocusThread}
              {onCommentPosted}
              {communityPubkey}
            />
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>
