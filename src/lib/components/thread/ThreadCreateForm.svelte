<!--
  ThreadCreateForm Component
  Modal form for creating a new forum thread (kind 11)
-->

<script>
  import { EventFactory } from 'applesauce-core/event-factory';
  import { publishEventOptimistic } from '$lib/services/publish-service.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { showToast } from '$lib/helpers/toast.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} Props
   * @property {string} communityPubkey - The community's pubkey (for h-tag)
   * @property {any} activeUser - The currently active user with signer
   * @property {boolean} open - Whether the modal is open
   * @property {() => void} onclose - Callback to close the modal
   * @property {(event: any) => void} [onCreated] - Callback when thread is created
   */

  /** @type {Props} */
  let { communityPubkey, activeUser, open, onclose, onCreated } = $props();

  let title = $state('');
  let content = $state('');
  let tagInput = $state('');
  let tags = $state(/** @type {string[]} */ ([]));
  let isPosting = $state(false);

  function addTag() {
    const tag = tagInput.trim().toLowerCase().replace(/^#/, '');
    if (tag && !tags.includes(tag)) {
      tags = [...tags, tag];
    }
    tagInput = '';
  }

  /**
   * @param {string} tag
   */
  function removeTag(tag) {
    tags = tags.filter((t) => t !== tag);
  }

  /**
   * @param {KeyboardEvent} e
   */
  function handleTagKeydown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    }
  }

  async function handleSubmit() {
    if (!activeUser || !title.trim() || !content.trim() || !communityPubkey) return;

    isPosting = true;

    try {
      /** @type {string[][]} */
      const eventTags = [
        ['h', communityPubkey],
        ['title', title.trim()]
      ];

      for (const tag of tags) {
        eventTags.push(['t', tag]);
      }

      const factory = new EventFactory({ signer: activeUser.signer });
      const signedEvent = await factory.sign(
        await factory.build({
          kind: 11,
          content: content.trim(),
          tags: eventTags
        })
      );
      isPosting = false;

      // Add to EventStore for instant UI feedback
      eventStore.add(signedEvent);

      // Publish in background
      publishEventOptimistic(signedEvent, [communityPubkey]);

      showToast(m.thread_create_success(), 'success');

      // Reset form
      title = '';
      content = '';
      tags = [];
      tagInput = '';

      onCreated?.(signedEvent);
      onclose();
    } catch (error) {
      console.error('Failed to create thread:', error);
      showToast(m.thread_create_error(), 'error');
      isPosting = false;
    }
  }
</script>

<dialog class="modal" class:modal-open={open}>
  <div class="modal-box max-w-2xl">
    <h3 class="text-lg font-bold">{m.thread_create_title()}</h3>

    <form
      onsubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
      class="mt-4 space-y-4"
    >
      <!-- Title -->
      <div class="form-control">
        <label class="label" for="thread-title">
          <span class="label-text">{m.thread_create_title_label()}</span>
        </label>
        <input
          id="thread-title"
          type="text"
          bind:value={title}
          class="input-bordered input w-full"
          placeholder={m.thread_create_title_placeholder()}
          required
          disabled={isPosting}
        />
      </div>

      <!-- Content -->
      <div class="form-control">
        <label class="label" for="thread-content">
          <span class="label-text">{m.thread_create_content_label()}</span>
        </label>
        <textarea
          id="thread-content"
          bind:value={content}
          class="textarea-bordered textarea w-full"
          rows="6"
          placeholder={m.thread_create_content_placeholder()}
          required
          disabled={isPosting}
        ></textarea>
        <div class="label">
          <span class="label-text-alt text-base-content/50">{m.thread_create_markdown_hint()}</span>
        </div>
      </div>

      <!-- Tags -->
      <div class="form-control">
        <label class="label" for="thread-tags">
          <span class="label-text">{m.thread_create_tags_label()}</span>
        </label>
        <div class="flex gap-2">
          <input
            id="thread-tags"
            type="text"
            bind:value={tagInput}
            class="input-bordered input flex-1"
            placeholder={m.thread_create_tags_placeholder()}
            onkeydown={handleTagKeydown}
            disabled={isPosting}
          />
          <button
            type="button"
            class="btn btn-outline"
            onclick={addTag}
            disabled={!tagInput.trim() || isPosting}
          >
            {m.thread_create_add_tag()}
          </button>
        </div>
        {#if tags.length > 0}
          <div class="mt-2 flex flex-wrap gap-1">
            {#each tags as tag (tag)}
              <span class="badge gap-1 badge-primary">
                #{tag}
                <button
                  type="button"
                  class="btn btn-circle btn-ghost btn-xs"
                  onclick={() => removeTag(tag)}
                  aria-label={m.thread_create_remove_tag()}>x</button
                >
              </span>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Actions -->
      <div class="modal-action">
        <button type="button" class="btn btn-ghost" onclick={onclose} disabled={isPosting}>
          {m.common_cancel()}
        </button>
        <button
          type="submit"
          class="btn btn-primary"
          disabled={!title.trim() || !content.trim() || isPosting}
        >
          {#if isPosting}
            <span class="loading loading-sm loading-spinner"></span>
            {m.thread_create_posting()}
          {:else}
            {m.thread_create_submit()}
          {/if}
        </button>
      </div>
    </form>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button onclick={onclose}>close</button>
  </form>
</dialog>
