<!--
  CreateRoomModal — Form for creating a new meet room (kind 30312).
-->

<script>
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { createAppEventFactory } from '$lib/helpers/event-factory.js';
  import { publishEventOptimistic } from '$lib/services/publish-service.js';
  import { buildRoomEventTags } from '$lib/helpers/meet.js';
  import { showToast } from '$lib/helpers/toast.js';
  import * as m from '$lib/paraglide/messages';

  let { modalId } = $props();

  let communityPubkey = $derived(
    /** @type {string} */ (/** @type {any} */ (modalStore.modalProps)?.communityPubkey) || ''
  );
  let livekitUrl = $derived(
    /** @type {string} */ (/** @type {any} */ (modalStore.modalProps)?.livekitUrl) || ''
  );

  let name = $state('');
  let summary = $state('');
  let type = $state(/** @type {'video' | 'audio'} */ ('video'));
  let duration = $state(/** @type {number} */ (3600));
  let isCreating = $state(false);

  const DURATION_OPTIONS = [
    { value: 0, label: () => m.meet_room_duration_none() },
    { value: 3600, label: () => m.meet_room_duration_1h() },
    { value: 7200, label: () => m.meet_room_duration_2h() },
    { value: 14400, label: () => m.meet_room_duration_4h() }
  ];

  async function handleCreate() {
    if (!name.trim() || !manager.active || isCreating) return;

    isCreating = true;
    try {
      const tags = buildRoomEventTags({
        name: name.trim(),
        summary: summary.trim() || undefined,
        type,
        communityPubkey,
        serviceUrl: livekitUrl,
        hostPubkey: manager.active.pubkey,
        duration: duration || undefined
      });

      const draft = {
        kind: 30312,
        content: '',
        tags,
        created_at: Math.floor(Date.now() / 1000)
      };

      const factory = createAppEventFactory({ signer: manager.signer });
      const signed = await factory.sign(draft);
      publishEventOptimistic(signed, [communityPubkey], {
        communityEvent: eventStore.getReplaceable(10222, communityPubkey)
      });

      showToast(m.meet_room_created(), 'success');
      modalStore.closeModal();
      resetForm();
    } catch (err) {
      console.error('Failed to create room:', err);
      showToast(m.meet_room_create_error(), 'error');
    } finally {
      isCreating = false;
    }
  }

  function resetForm() {
    name = '';
    summary = '';
    type = 'video';
    duration = 3600;
  }
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box max-w-md">
    <h3 class="text-lg font-bold">{m.meet_create_room_title()}</h3>

    <form
      onsubmit={(e) => {
        e.preventDefault();
        handleCreate();
      }}
      class="mt-4 space-y-4"
    >
      <!-- Room name -->
      <div class="form-control">
        <label class="label" for="room-name">
          <span class="label-text">{m.meet_room_name()}</span>
        </label>
        <input
          id="room-name"
          type="text"
          class="input-bordered input"
          placeholder={m.meet_room_name_placeholder()}
          bind:value={name}
          required
        />
      </div>

      <!-- Description -->
      <div class="form-control">
        <label class="label" for="room-desc">
          <span class="label-text">{m.meet_room_description()}</span>
        </label>
        <textarea
          id="room-desc"
          class="textarea-bordered textarea"
          placeholder={m.meet_room_description_placeholder()}
          bind:value={summary}
          rows="2"
        ></textarea>
      </div>

      <!-- Room type -->
      <div class="form-control">
        <label class="label">
          <span class="label-text">{m.meet_room_type()}</span>
        </label>
        <div class="flex gap-2">
          <button
            type="button"
            class="btn flex-1 btn-sm {type === 'video' ? 'btn-primary' : 'btn-ghost btn-outline'}"
            onclick={() => (type = 'video')}
          >
            {m.meet_room_type_video()}
          </button>
          <button
            type="button"
            class="btn flex-1 btn-sm {type === 'audio' ? 'btn-primary' : 'btn-ghost btn-outline'}"
            onclick={() => (type = 'audio')}
          >
            {m.meet_room_type_audio()}
          </button>
        </div>
      </div>

      <!-- Duration -->
      <div class="form-control">
        <label class="label" for="room-duration">
          <span class="label-text">{m.meet_room_duration()}</span>
        </label>
        <select id="room-duration" class="select-bordered select" bind:value={duration}>
          {#each DURATION_OPTIONS as opt (opt.value)}
            <option value={opt.value}>{opt.label()}</option>
          {/each}
        </select>
      </div>

      <!-- Actions -->
      <div class="modal-action">
        <button type="button" class="btn btn-ghost" onclick={() => modalStore.closeModal()}>
          {m.common_cancel()}
        </button>
        <button type="submit" class="btn btn-primary" disabled={!name.trim() || isCreating}>
          {#if isCreating}
            <span class="loading loading-xs loading-spinner"></span>
          {/if}
          {m.meet_create_room()}
        </button>
      </div>
    </form>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button>close</button>
  </form>
</dialog>
