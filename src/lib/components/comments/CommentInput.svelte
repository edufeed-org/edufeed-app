<script>
  import { createAppEventFactory } from '$lib/helpers/event-factory.js';
  import { CommentBlueprint } from 'applesauce-common/blueprints';
  import { publishEventOptimistic } from '$lib/services/publish-service.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} CommentInputProps
   * @property {any} rootEvent - The root event being commented on
   * @property {any} [parentItem] - The parent item (null/undefined for top-level, comment object for replies)
   * @property {any} activeUser - The currently active user with signer
   * @property {string} [placeholder] - Placeholder text for the input
   * @property {(event: any) => void} [onCommentPosted] - Callback when comment is successfully posted
   * @property {(() => void)|null} [onCancel] - Callback when cancel is clicked (for reply forms)
   * @property {boolean} [autoFocus] - Whether to auto-focus the textarea
   * @property {string} [communityPubkey] - Community hex pubkey to add as #h tag
   */

  /** @type {CommentInputProps} */
  let {
    rootEvent,
    parentItem = null,
    activeUser,
    placeholder = 'Write a comment...',
    onCommentPosted = (/** @type {any} */ _event) => {},
    onCancel = null,
    autoFocus = false,
    communityPubkey = undefined
  } = $props();

  let content = $state('');
  let isPosting = $state(false);
  let error = $state('');
  let textareaElement = $state(/** @type {HTMLTextAreaElement|null} */ (null));

  // Auto-focus if requested
  $effect(() => {
    if (autoFocus && textareaElement) {
      textareaElement.focus();
    }
  });

  /**
   * Post the comment
   */
  async function handleSubmit(/** @type {Event} */ e) {
    e.preventDefault();

    if (!activeUser || !content.trim() || !rootEvent) return;

    const commentContent = content.trim();
    content = ''; // Clear input immediately for instant feedback
    error = '';
    isPosting = true; // Show loading during signing (may require user approval)

    try {
      const factory = createAppEventFactory({ signer: activeUser.signer });

      // CommentBlueprint handles NIP-22 tag generation (root/reply pointers)
      const parent = parentItem || rootEvent;
      const draft = await factory.create(CommentBlueprint, parent, commentContent);

      // Add community #h tag for deep-linking support
      if (communityPubkey) {
        draft.tags.push(['h', communityPubkey]);
      }

      const signedEvent = await factory.sign(draft);
      isPosting = false;

      // Add to eventStore immediately for instant UI update
      eventStore.add(signedEvent);

      // Call callback immediately (optimistic)
      onCommentPosted(signedEvent);

      // Publish optimistically in background (returns immediately)
      publishEventOptimistic(signedEvent, [rootEvent.pubkey]);
    } catch (err) {
      console.error('Failed to post comment:', err);
      error = m.comments_input_generic_error();
      // Restore content if signing failed
      content = commentContent;
      isPosting = false;
    }
  }
</script>

<form onsubmit={handleSubmit} class="space-y-2">
  <textarea
    bind:this={textareaElement}
    bind:value={content}
    {placeholder}
    class="textarea-bordered textarea w-full"
    rows="3"
    disabled={isPosting}
    required
    data-testid="comment-input"
  ></textarea>

  {#if error}
    <div class="alert alert-error">
      <span>{error}</span>
    </div>
  {/if}

  <div class="flex justify-end gap-2">
    {#if onCancel}
      <button type="button" class="btn btn-ghost" onclick={onCancel} disabled={isPosting}>
        {m.comments_input_cancel_button()}
      </button>
    {/if}
    <button
      type="submit"
      class="btn btn-primary"
      disabled={!content.trim() || isPosting}
      data-testid="comment-submit-btn"
    >
      {#if isPosting}
        <span class="loading loading-sm loading-spinner"></span>
        {m.comments_input_posting()}
      {:else}
        {m.comments_input_post_button()}
      {/if}
    </button>
  </div>
</form>
