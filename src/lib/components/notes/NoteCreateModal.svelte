<!--
  NoteCreateModal — compose and publish a kind 1 short text note (issue #36).
  Write/Preview tabs, paste-a-reference insertion (nostr: URIs render as
  embedded cards in the feed), optional community h-tag targeting.
-->

<script>
  import 'applesauce-common';
  import { untrack } from 'svelte';
  import { NoteBlueprint } from 'applesauce-common/blueprints';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { createAppEventFactory } from '$lib/helpers/event-factory.js';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import {
    parseReferenceToken,
    buildReferenceUri,
    insertReferenceIntoContent
  } from '$lib/helpers/noteReferences.js';
  import NostrContentRenderer from '$lib/components/shared/NostrContentRenderer.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} Props
   * @property {string} [communityPubkey]
   */
  /** @type {Props} */
  let { communityPubkey = '' } = $props();

  const getActiveUser = useActiveUser();

  let content = $state('');
  /** @type {'write' | 'preview'} */
  let activeTab = $state('write');
  let referenceInput = $state('');
  let referenceError = $state('');
  let isSubmitting = $state(false);
  let submitError = $state('');
  let community = $state(untrack(() => communityPubkey));

  const canSubmit = $derived(content.trim().length > 0 && !isSubmitting);

  // Fresh object per derive so applesauce's Symbol-keyed parse cache stays
  // correct. Only built while the preview tab is active.
  const previewEvent = $derived.by(() => {
    if (activeTab !== 'preview') return null;
    return {
      kind: 1,
      content,
      tags: [],
      pubkey: getActiveUser()?.pubkey ?? '',
      created_at: Math.floor(Date.now() / 1000),
      id: '',
      sig: ''
    };
  });

  const getJoinedCommunities = useJoinedCommunitiesList();
  let communities = $derived(getJoinedCommunities());
  const getProfileMap = useProfileMap(() => communities);
  let profileMap = $derived(getProfileMap());
  let communityPubkeys = $derived(
    communityPubkey && !communities.includes(communityPubkey)
      ? [communityPubkey, ...communities]
      : communities
  );

  function insertReference() {
    const token = parseReferenceToken(referenceInput);
    if (!token) {
      referenceError = m.note_create_modal_reference_invalid();
      return;
    }
    content = insertReferenceIntoContent(content, buildReferenceUri(token));
    referenceInput = '';
    referenceError = '';
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    const activeUser = getActiveUser();
    if (!activeUser) {
      submitError = m.note_create_modal_error_login();
      return;
    }

    isSubmitting = true;
    submitError = '';

    try {
      /** @type {any | null} */
      let communityEvent = null;
      if (community) {
        communityEvent = eventStore.getReplaceable(10222, community) || null;
      }

      const factory = createAppEventFactory({ signer: activeUser.signer });
      const draft = await factory.create(NoteBlueprint, content.trim());

      // NoteBlueprint doesn't add h-tags; append for community targeting.
      if (community) draft.tags.push(['h', community]);

      const signed = await factory.sign(draft);

      eventStore.add(signed);
      const result = await publishEvent(signed, [], { communityEvent });
      if (!result.success) {
        submitError = m.note_create_modal_error_publish();
        return;
      }

      content = '';
      modalStore.closeModal();
      // No goto — the feed's EventStore subscription already shows the note.
    } catch (err) {
      submitError = /** @type {any} */ (err)?.message ?? String(err);
    } finally {
      isSubmitting = false;
    }
  }
</script>

<dialog open class="modal-open modal">
  <div class="modal-box max-w-xl">
    <h3 class="mb-4 text-lg font-bold">{m.note_create_modal_title()}</h3>

    <!-- Write / Preview tabs -->
    <div role="tablist" class="tabs-border mb-2 tabs">
      <button
        role="tab"
        class="tab {activeTab === 'write' ? 'tab-active' : ''}"
        data-testid="note-tab-write"
        onclick={() => (activeTab = 'write')}
      >
        {m.article_editor_tab_write()}
      </button>
      <button
        role="tab"
        class="tab {activeTab === 'preview' ? 'tab-active' : ''}"
        data-testid="note-tab-preview"
        onclick={() => (activeTab = 'preview')}
      >
        {m.article_editor_tab_preview()}
      </button>
    </div>

    {#if activeTab === 'write'}
      <textarea
        class="textarea-bordered textarea w-full"
        rows="5"
        placeholder={m.note_create_modal_content_placeholder()}
        data-testid="note-content-input"
        bind:value={content}
      ></textarea>
    {:else}
      <div
        class="min-h-32 rounded-lg border border-base-300 bg-base-200/30 p-3"
        data-testid="note-preview-pane"
      >
        {#if content.trim() && previewEvent}
          <NostrContentRenderer event={previewEvent} />
        {:else}
          <p class="text-sm text-base-content/50">{m.note_create_modal_preview_empty()}</p>
        {/if}
      </div>
    {/if}

    <!-- Reference insertion -->
    <div class="form-control mt-3">
      <span class="label-text mb-1 block">{m.note_create_modal_reference_label()}</span>
      <div class="flex gap-2">
        <input
          class="input-bordered input input-sm flex-1"
          placeholder={m.note_create_modal_reference_placeholder()}
          data-testid="note-reference-input"
          bind:value={referenceInput}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              insertReference();
            }
          }}
        />
        <button
          type="button"
          class="btn btn-sm"
          data-testid="note-reference-insert"
          disabled={!referenceInput.trim()}
          onclick={insertReference}
        >
          {m.note_create_modal_reference_insert()}
        </button>
      </div>
      {#if referenceError}
        <span class="mt-1 text-xs text-error" data-testid="note-reference-error">
          {referenceError}
        </span>
      {/if}
    </div>

    <!-- Community targeting -->
    {#if communityPubkeys.length > 0}
      <label class="form-control mt-3">
        <span class="label-text mb-1 block">{m.note_create_modal_community_label()}</span>
        <select
          class="select-bordered select select-sm"
          bind:value={community}
          aria-label={m.note_create_modal_community_label()}
        >
          <option value="">{m.note_create_modal_community_none()}</option>
          {#each communityPubkeys as pubkey (pubkey)}
            {@const profile = profileMap.get(pubkey)}
            <option value={pubkey}>{getDisplayName(profile) || pubkey.slice(0, 8)}</option>
          {/each}
        </select>
      </label>
    {/if}

    {#if submitError}
      <div class="mt-3 alert alert-error" role="alert">
        <span class="text-sm">{submitError}</span>
      </div>
    {/if}

    <div class="modal-action">
      <button
        type="button"
        class="btn btn-ghost"
        disabled={isSubmitting}
        onclick={() => modalStore.closeModal()}
      >
        {m.common_cancel()}
      </button>
      <button
        type="button"
        class="btn btn-primary"
        data-testid="note-publish-button"
        disabled={!canSubmit || isSubmitting}
        onclick={handleSubmit}
      >
        {#if isSubmitting}
          <span class="loading loading-sm loading-spinner"></span>
        {/if}
        {m.note_create_modal_publish()}
      </button>
    </div>
  </div>
  <button
    type="button"
    class="modal-backdrop"
    aria-label="Close"
    onclick={() => modalStore.closeModal()}
  ></button>
</dialog>
