<script>
  import { createCommentLoaderForEvent, createCommentLoaderForUrl } from '$lib/loaders/comments.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { TimelineModel } from 'applesauce-core/models';
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
   * @property {any} [rootEvent] - The root event being commented on (event-rooted thread)
   * @property {string} [rootUrl] - The URL being commented on (URL-rooted page-note thread, NIP-22 external pointer). Provide exactly one of rootEvent or rootUrl.
   * @property {any} activeUser - The currently active user (null if not logged in)
   * @property {boolean} [collapsedReplies] - When true, replies start collapsed with expand toggle
   * @property {string|null} [initialFocusCommentId] - Comment ID to auto-focus on mount (deep-linking)
   * @property {string} [communityPubkey] - Community hex pubkey for #h tag on comments
   * @property {string[]} [extraRelays] - Additional relays to query for comments
   */

  /** @type {CommentListProps} */
  let {
    rootEvent = undefined,
    rootUrl = undefined,
    activeUser,
    collapsedReplies = false,
    initialFocusCommentId = null,
    communityPubkey = undefined,
    extraRelays = undefined
  } = $props();

  // $state.raw: comment events carry Symbol-based seen-relays metadata; deep
  // proxying breaks it (see CLAUDE.md). The array is always replaced wholesale.
  let flatComments = $state.raw(/** @type {any[]} */ ([]));
  let isLoading = $state(true);
  let commentTree = $derived(buildCommentTree(flatComments));
  let totalCount = $derived(countComments(commentTree));
  /** @type {import('rxjs').Subscription | undefined} */
  let loaderSubscription;

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
  // Instead of isolating into subtree mode, expand the path and scroll+highlight
  let hasAutoFocused = false;
  $effect(() => {
    if (initialFocusCommentId && !isLoading && commentTree.length > 0 && !hasAutoFocused) {
      const chain = getParentChain(commentTree, initialFocusCommentId);
      if (chain.length > 0) {
        hasAutoFocused = true;
        // Expand the entire path to the comment so it's visible
        expandedIds = new Set(chain.map((c) => c.id));
        // Scroll to and highlight the comment
        scrollToCommentId = initialFocusCommentId;
      }
    }
  });

  // A single root-scope TimelineModel is the source of truth for the whole
  // thread. NIP-22 replies at any depth carry the root scope (#I for URLs, #E
  // for events); NIP-10 kind-1 replies carry the root id in an #e tag. One
  // filter set therefore captures the entire tree, and TimelineModel handles
  // dedup, ordering, and NIP-09 deletion filtering for us.
  //
  // The model subscription starts immediately (renders cached events from
  // EventStore). The relay loader is deferred 300ms to avoid blocking content
  // render on navigation; it writes into EventStore, which the model observes.
  $effect(() => {
    if (!rootEvent && !rootUrl) return;

    isLoading = true;

    /** @type {import('rxjs').Subscription | undefined} */
    let timelineSubscription;

    if (rootUrl) {
      timelineSubscription = eventStore
        .model(TimelineModel, { kinds: [1111], '#I': [rootUrl] })
        .subscribe((/** @type {any[]} */ events) => {
          flatComments = events || [];
          if (flatComments.length > 0) isLoading = false;
        });
    } else if (rootEvent) {
      /** @type {any[]} */
      const filters = [{ kinds: [1111], '#E': [rootEvent.id] }];
      // Addressable roots (kind 30000-39999) accumulate comments anchored to
      // their coordinate via uppercase #A, which survives event replacement and
      // is what some clients use instead of (or alongside) #E.
      if (rootEvent.kind >= 30000 && rootEvent.kind < 40000) {
        const dTag = rootEvent.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || '';
        filters.push({
          kinds: [1111],
          '#A': [`${rootEvent.kind}:${rootEvent.pubkey}:${dTag}`]
        });
      }
      // Kind-1 roots also accumulate NIP-10 kind-1 replies via lowercase #e.
      if (rootEvent.kind === 1) filters.push({ kinds: [1], '#e': [rootEvent.id] });
      timelineSubscription = eventStore
        .model(TimelineModel, filters)
        .subscribe((/** @type {any[]} */ events) => {
          flatComments = events || [];
          if (flatComments.length > 0) isLoading = false;
        });
    }

    // Defer relay fetching to avoid blocking content render
    const loaderTimer = setTimeout(() => {
      const commentLoader = rootUrl
        ? createCommentLoaderForUrl(rootUrl, extraRelays)
        : createCommentLoaderForEvent(rootEvent, extraRelays);
      loaderSubscription = commentLoader().subscribe({
        error: (/** @type {any} */ err) => {
          console.error('CommentList: Error in comment loader:', err);
          isLoading = false;
        },
        complete: () => {
          isLoading = false;
        }
      });
    }, 300);

    // Fallback timeout: If loader doesn't complete within 2s, stop loading.
    const loadingTimeout = setTimeout(() => {
      if (isLoading) {
        isLoading = false;
      }
    }, 2000);

    return () => {
      clearTimeout(loaderTimer);
      clearTimeout(loadingTimeout);
      timelineSubscription?.unsubscribe();
      loaderSubscription?.unsubscribe();
    };
  });

  /**
   * Handle new comment posted. CommentInput already calls eventStore.add(),
   * which the TimelineModel subscription observes, so the new comment appears
   * automatically. Nothing to do here.
   */
  function handleCommentPosted() {}

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
  <div class="card bg-base-100 shadow-lg">
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
            {rootUrl}
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
