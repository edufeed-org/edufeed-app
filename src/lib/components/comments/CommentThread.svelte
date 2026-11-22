<script>
  import Comment from './Comment.svelte';
  import CommentThread from './CommentThread.svelte';
  import { countComments } from '$lib/helpers/commentThreading.js';
  import * as m from '$lib/paraglide/messages';

  /** Max visual nesting depth before showing "Continue thread" */
  const MAX_NESTING_DEPTH = 3;

  /**
   * @typedef {Object} CommentThreadProps
   * @property {any} comment - The comment with nested replies
   * @property {any} rootEvent - The root event being commented on
   * @property {any} activeUser - The currently active user
   * @property {number} [depth] - Current nesting depth
   * @property {any} [parentComment] - The comment this one answers
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
    parentComment = undefined,
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

  let hasReplies = $derived(comment.replies && comment.replies.length > 0);
  let replyCount = $derived(hasReplies ? countComments(comment.replies) : 0);
  let shouldCollapse = $derived(collapsedReplies && hasReplies && !expanded);
  let shouldShowContinueThread = $derived(hasReplies && depth >= maxDepth && onFocusThread);

  // The replies control sits in the parent's actions row (Comment renders it).
  let repliesAction = $derived.by(() => {
    if (!hasReplies) return undefined;
    if (shouldShowContinueThread) {
      return {
        label:
          replyCount === 1
            ? m.comments_continue_thread_singular()
            : m.comments_continue_thread({ count: replyCount }),
        onclick: () => onFocusThread?.(comment.id),
        testid: 'continue-thread-btn'
      };
    }
    if (shouldCollapse) {
      return {
        label:
          replyCount === 1
            ? m.comments_view_reply()
            : m.comments_view_replies({ count: replyCount }),
        onclick: () => (expanded = true),
        testid: 'expand-replies-btn',
        expanded: false
      };
    }
    if (collapsedReplies && expanded) {
      return {
        label: m.comments_hide_replies(),
        onclick: () => (expanded = false),
        testid: 'collapse-replies-btn',
        expanded: true
      };
    }
    return undefined;
  });

  // Visual indent of the replies below this comment: one step on phones, two on
  // wider screens, then the rows stay put and the reply chip carries the parent.
  const REPLY_INDENT = ['pl-9 sm:pl-[50px]', 'sm:pl-10'];
  let repliesIndent = $derived(REPLY_INDENT[depth] ?? '');
</script>

<div>
  <Comment
    {comment}
    {rootEvent}
    {activeUser}
    {depth}
    {parentComment}
    {repliesAction}
    {onCommentPosted}
    {communityPubkey}
  />

  {#if hasReplies && !shouldShowContinueThread && !shouldCollapse}
    <div class={repliesIndent} data-testid="comment-replies">
      {#each comment.replies as reply (reply.id)}
        <CommentThread
          comment={reply}
          parentComment={comment}
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
      {/each}
    </div>
  {/if}
</div>
