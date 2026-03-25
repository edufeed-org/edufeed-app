<script>
  // Use regular Map for internal tracking - SvelteMap inside subscription callbacks
  // can cause effect_update_depth_exceeded errors. UI updates driven by flatComments ($state).
  /* eslint-disable svelte/prefer-svelte-reactivity -- Map used intentionally to avoid infinite loops */
  import { createCommentLoaderForEvent } from '$lib/loaders/comments.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { RepliesModel } from 'applesauce-common/models';
  import {
    buildCommentTree,
    countComments,
    getParentChain,
    getSubtree
  } from '$lib/helpers/commentThreading.js';
  import CommentThread from './CommentThread.svelte';
  import CommentInput from './CommentInput.svelte';
  import AncestorChain from './AncestorChain.svelte';
  import { ChevronLeftIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} CommentListProps
   * @property {any} rootEvent - The root event being commented on
   * @property {any} activeUser - The currently active user (null if not logged in)
   * @property {boolean} [collapsedReplies] - When true, replies start collapsed with expand toggle
   * @property {string|null} [initialFocusCommentId] - Comment ID to auto-focus on mount (deep-linking)
   * @property {string} [communityPubkey] - Community hex pubkey for #h tag on comments
   * @property {string[]} [extraRelays] - Additional relays to query for comments
   */

  /** @type {CommentListProps} */
  let {
    rootEvent,
    activeUser,
    collapsedReplies = false,
    initialFocusCommentId = null,
    communityPubkey = undefined,
    extraRelays = undefined
  } = $props();

  let flatComments = $state(/** @type {any[]} */ ([]));
  let isLoading = $state(true);
  let commentTree = $derived(buildCommentTree(flatComments));
  let totalCount = $derived(countComments(commentTree));
  // Map to track loaded comments and prevent duplicates
  let loadedComments = new Map();
  /** @type {import('rxjs').Subscription | undefined} */
  let loaderSubscription;
  // Map to track model subscriptions for each comment (commentId -> subscription)
  let modelSubscriptions = new Map();

  // Stack-based focus history: each entry is a commentId
  /** @type {string[]} */
  let focusHistory = $state.raw([]);

  // Comment ID to scroll to after back navigation (cleared after scroll completes)
  /** @type {string|null} */
  let scrollToCommentId = $state(null);

  // IDs of comments whose replies should be force-expanded (path to scrollToCommentId)
  /** @type {Set<string>} */
  let expandedIds = $state.raw(new Set());

  let focusedCommentId = $derived(focusHistory.at(-1) ?? null);

  // When focused on a subtree, compute the subtree and ancestor chain
  let focusedSubtree = $derived.by(() => {
    if (!focusedCommentId) return null;
    return getSubtree(commentTree, focusedCommentId);
  });

  // Ancestors: path from root to focused comment, exclusive of the focused comment itself
  let ancestors = $derived.by(() => {
    if (!focusedCommentId) return [];
    const chain = getParentChain(commentTree, focusedCommentId);
    // Remove last element (the focused comment itself)
    return chain.length > 1 ? chain.slice(0, -1) : [];
  });

  // Comments to display: either full tree or focused subtree
  let displayComments = $derived.by(() => {
    if (focusedSubtree) {
      return [focusedSubtree];
    }
    return commentTree;
  });

  // Auto-focus on mount for deep-linked comments (one-shot)
  let hasAutoFocused = false;
  $effect(() => {
    if (
      initialFocusCommentId &&
      !isLoading &&
      commentTree.length > 0 &&
      focusHistory.length === 0 &&
      !hasAutoFocused
    ) {
      const subtree = getSubtree(commentTree, initialFocusCommentId);
      if (subtree) {
        hasAutoFocused = true;
        focusHistory = [initialFocusCommentId];
      }
    }
  });

  /**
   * Subscribe to CommentsModel for a specific comment to watch for replies
   * @param {any} comment - The comment event to watch
   */
  function subscribeToCommentReplies(comment) {
    // Don't subscribe if we already have a subscription for this comment
    if (modelSubscriptions.has(comment.id)) return;

    const subscription = eventStore.model(RepliesModel, comment).subscribe((replies) => {
      let hasChanges = false;

      // Process each reply
      for (const reply of replies || []) {
        if (!loadedComments.has(reply.id)) {
          loadedComments.set(reply.id, reply);
          hasChanges = true;

          // Recursively subscribe to this reply's replies
          subscribeToCommentReplies(reply);
        }
      }

      // Check for deletions: if a reply we had is no longer in the list
      const replyIds = new Set((replies || []).map((r) => r.id));
      for (const [id, existingReply] of loadedComments) {
        // Check if this comment was a reply to the current comment
        // and is now missing from the replies list
        if (
          existingReply.tags?.some((/** @type {any[]} */ t) => t[0] === 'e' && t[1] === comment.id)
        ) {
          if (!replyIds.has(id)) {
            loadedComments.delete(id);
            hasChanges = true;
          }
        }
      }

      if (hasChanges) {
        flatComments = Array.from(loadedComments.values());
      }
    });

    modelSubscriptions.set(comment.id, subscription);
  }

  // Load comments using loader + recursive model subscriptions
  $effect(() => {
    if (!rootEvent) return;

    isLoading = true;

    // Reset state
    loadedComments.clear();
    modelSubscriptions.forEach((sub) => sub.unsubscribe());
    modelSubscriptions.clear();

    // Subscribe to the root event's direct comments
    subscribeToCommentReplies(rootEvent);

    // Source: Loader fetches ALL comments from relays and adds to EventStore
    const commentLoader = createCommentLoaderForEvent(rootEvent, extraRelays);
    loaderSubscription = commentLoader().subscribe({
      next: (/** @type {any} */ comment) => {
        // Add to our loaded comments map
        if (!loadedComments.has(comment.id)) {
          loadedComments.set(comment.id, comment);
          flatComments = Array.from(loadedComments.values());

          // Subscribe to this comment's replies
          subscribeToCommentReplies(comment);
        }
        // Set loading to false once we have any data to display
        if (isLoading) {
          isLoading = false;
        }
      },
      error: (/** @type {any} */ err) => {
        console.error('CommentList: Error in comment loader:', err);
        isLoading = false;
      },
      complete: () => {
        // Also set loading to false on complete (handles case of no comments)
        isLoading = false;
      }
    });

    // Fallback timeout: If loader doesn't complete within 3s, stop loading.
    const loadingTimeout = setTimeout(() => {
      if (isLoading) {
        isLoading = false;
      }
    }, 3000);

    return () => {
      clearTimeout(loadingTimeout);
      loaderSubscription?.unsubscribe();
      // Unsubscribe from all comment model subscriptions
      modelSubscriptions.forEach((sub) => sub.unsubscribe());
      modelSubscriptions.clear();
    };
  });

  /**
   * Handle new comment posted
   * Immediately add to UI for instant feedback
   */
  function handleCommentPosted(/** @type {any} */ event) {
    // Add to map to deduplicate (in case relay echoes it back)
    if (!loadedComments.has(event.id)) {
      loadedComments.set(event.id, event);
      // Update flatComments array to trigger reactive update
      flatComments = Array.from(loadedComments.values());

      // Subscribe to this comment's replies
      subscribeToCommentReplies(event);
    }
  }

  /**
   * Push a new focus level onto the stack
   * @param {string} commentId
   */
  function handleFocusThread(commentId) {
    focusHistory = [...focusHistory, commentId];
  }

  /**
   * Pop one level from the stack (go back)
   */
  function handleBack() {
    const returningToId = focusHistory.at(-1);
    focusHistory = focusHistory.slice(0, -1);

    if (returningToId) {
      const chain = getParentChain(commentTree, returningToId);
      expandedIds = new Set(chain.map((c) => c.id));
      scrollToCommentId = returningToId;
    }
  }

  /**
   * Clear the entire stack (back to full thread)
   */
  function handleBackToFullThread() {
    const returningToId = focusHistory[0];
    focusHistory = [];

    if (returningToId) {
      const chain = getParentChain(commentTree, returningToId);
      expandedIds = new Set(chain.map((c) => c.id));
      scrollToCommentId = returningToId;
    }
  }

  /**
   * Navigate to an ancestor: if already in stack, pop to it; otherwise push
   * @param {string} commentId
   */
  function handleAncestorClick(commentId) {
    const idx = focusHistory.indexOf(commentId);
    if (idx !== -1) {
      // Already in stack — pop to that level
      focusHistory = focusHistory.slice(0, idx + 1);
    } else {
      // Not in stack — push it
      focusHistory = [...focusHistory, commentId];
    }
  }

  // Scroll to comment after back navigation
  $effect(() => {
    if (!scrollToCommentId) return;
    const targetId = scrollToCommentId;

    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-comment-id="${targetId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('comment-highlight');
        setTimeout(() => el.classList.remove('comment-highlight'), 2000);
      }
      scrollToCommentId = null;
    });
  });
</script>

<div class="comment-list" data-testid="comment-list">
  <div class="card bg-base-200 shadow-lg">
    <div class="card-body">
      <div class="flex items-center justify-between">
        <h2 class="card-title text-2xl">{m.comments_list_title()}</h2>
        {#if totalCount > 0}
          <span class="badge badge-lg" data-testid="comment-count">{totalCount}</span>
        {/if}
      </div>

      <!-- Navigation bar when focused on subtree -->
      {#if focusedCommentId}
        <nav class="mt-3 flex flex-wrap items-center gap-1" data-testid="thread-navigation">
          <button class="btn gap-1 btn-ghost btn-sm" onclick={handleBack}>
            <ChevronLeftIcon class_="w-4 h-4" />
            {m.comments_back_button()}
          </button>
          {#if focusHistory.length > 1}
            <button
              class="btn text-base-content/60 btn-ghost btn-xs"
              onclick={handleBackToFullThread}
            >
              {m.comments_back_to_full_thread()}
            </button>
          {/if}
        </nav>

        <!-- Ancestor chain -->
        <AncestorChain {ancestors} onAncestorClick={handleAncestorClick} />
      {/if}

      <!-- Comment Input Form (top-level) -->
      {#if activeUser && !focusedCommentId}
        <div class="mt-4">
          <CommentInput
            {rootEvent}
            parentItem={null}
            {activeUser}
            placeholder={m.comments_list_placeholder()}
            onCommentPosted={handleCommentPosted}
            {communityPubkey}
          />
        </div>
      {:else if !activeUser}
        <div class="mt-4 rounded-lg bg-base-300 p-4 text-center" data-testid="comment-login-prompt">
          <p class="text-base-content/70">{m.comments_list_login_prompt()}</p>
        </div>
      {/if}

      <!-- Comments List -->
      <div class="mt-6 space-y-4">
        {#if isLoading}
          <div class="flex items-center justify-center py-8">
            <span class="loading loading-lg loading-spinner"></span>
          </div>
        {:else if displayComments.length === 0}
          <div class="py-8 text-center text-base-content/60">
            {m.comments_list_empty()}
          </div>
        {:else if focusedCommentId}
          <!-- Focused mode: render at depth 0, ancestor chain provides context -->
          {#each displayComments as comment (comment.id)}
            <CommentThread
              {comment}
              {rootEvent}
              {activeUser}
              depth={0}
              maxDepth={3}
              {collapsedReplies}
              {expandedIds}
              onFocusThread={handleFocusThread}
              onCommentPosted={handleCommentPosted}
              {communityPubkey}
            />
          {/each}
        {:else}
          {#each displayComments as comment (comment.id)}
            <CommentThread
              {comment}
              {rootEvent}
              {activeUser}
              depth={0}
              {collapsedReplies}
              {expandedIds}
              onFocusThread={handleFocusThread}
              onCommentPosted={handleCommentPosted}
              {communityPubkey}
            />
          {/each}
        {/if}
      </div>
    </div>
  </div>
</div>
