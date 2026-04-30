<script>
  import { createAppEventFactory } from '$lib/helpers/event-factory.js';
  import { CommentBlueprint } from 'applesauce-common/blueprints';
  import { publishEventOptimistic } from '$lib/services/publish-service.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import NostrContentRenderer from '$lib/components/shared/NostrContentRenderer.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} CommentInputProps
   * @property {any} [rootEvent] - The root event being commented on (event-rooted thread)
   * @property {string} [rootUrl] - The URL being commented on (URL-rooted page-note thread, NIP-22 external pointer)
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
    rootEvent = undefined,
    rootUrl = undefined,
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
  let activeTab = $state(/** @type {'write' | 'preview'} */ ('write'));

  // Fresh object per derive so applesauce's Symbol-keyed parse cache stays correct.
  // Only built while the preview tab is active to avoid pointless re-parsing on each keystroke.
  const previewEvent = $derived.by(() => {
    if (activeTab !== 'preview') return null;
    return {
      kind: 1111,
      content,
      tags: [],
      pubkey: activeUser?.pubkey ?? '',
      created_at: Math.floor(Date.now() / 1000),
      id: '',
      sig: ''
    };
  });

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

    if (!activeUser || !content.trim()) return;
    if (!rootEvent && !rootUrl) return;

    const commentContent = content.trim();
    content = ''; // Clear input immediately for instant feedback
    error = '';
    isPosting = true; // Show loading during signing (may require user approval)

    try {
      const factory = createAppEventFactory({ signer: activeUser.signer });

      // Determine parent: explicit reply parent → fallback to thread root.
      // For URL-rooted top-level posts, build a NIP-22 external pointer so
      // applesauce-common's setParent emits ["I", url] + ["K", "web"] tags.
      let parent;
      if (parentItem) {
        parent = parentItem;
      } else if (rootEvent) {
        parent = rootEvent;
      } else {
        parent = { type: 'external', identifier: rootUrl, kind: 'web' };
      }

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

      // Publish optimistically in background (returns immediately).
      // Tag the relevant author so the post reaches their read relays:
      // root event author for event-rooted threads, parent comment author for
      // replies in URL-rooted threads (no root event to tag).
      const taggedPubkeys = [];
      if (rootEvent?.pubkey) taggedPubkeys.push(rootEvent.pubkey);
      if (!rootEvent && parentItem?.pubkey) taggedPubkeys.push(parentItem.pubkey);
      publishEventOptimistic(signedEvent, taggedPubkeys);
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
  <div class="flex gap-1">
    <button
      type="button"
      class="btn btn-xs"
      class:btn-active={activeTab === 'write'}
      onclick={() => (activeTab = 'write')}
    >
      {m.article_editor_tab_write()}
    </button>
    <button
      type="button"
      class="btn btn-xs"
      class:btn-active={activeTab === 'preview'}
      onclick={() => (activeTab = 'preview')}
    >
      {m.article_editor_tab_preview()}
    </button>
  </div>

  {#if activeTab === 'write'}
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
  {:else}
    <div
      class="textarea-bordered textarea min-h-[5.5rem] w-full cursor-default"
      data-testid="comment-preview"
    >
      {#if content.trim() && previewEvent}
        <NostrContentRenderer event={previewEvent} />
      {:else}
        <p class="text-base-content/50 italic">{placeholder}</p>
      {/if}
    </div>
  {/if}

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
