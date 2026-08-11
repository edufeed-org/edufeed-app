<!--
  GroupSettingsSheet — Task 8. Admin-only: edit the group's kind-39000
  metadata (via a single 9002) and delete the group (9008, two-step confirm).

  Prefill: name/about/picture come from applesauce's parsed `metadata`
  (may be null). The public/open toggles read the RAW `metadataEvent` tags
  instead — applesauce's parser reads an older NIP-29 draft's inverse tags
  (see the comment on `metadataEvent` in GroupChat.svelte), so trusting
  `metadata.isPublic`/`isOpen` would silently invert the toggles.
-->
<script>
  import {
    buildEditGroupMetadataTemplate,
    buildDeleteGroupTemplate,
    publishToGroupRelay
  } from '$lib/groups/group-management.js';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   pointer: {id: string, relay: string},
   *   metadata: any,
   *   metadataEvent: any,
   *   onClose: () => void,
   *   onDeleted: () => void
   * }}
   */
  let { pointer, metadata, metadataEvent, onClose, onDeleted } = $props();

  const getActiveUser = useActiveUser();

  // Deliberate one-time prefill from props, not a live derivation: the form
  // owns its own draft state once opened, so it doesn't reset while the
  // admin is typing if a fresher metadata event lands from the relay.
  // svelte-ignore state_referenced_locally
  let name = $state(metadata?.name ?? '');
  // svelte-ignore state_referenced_locally
  let about = $state(metadata?.about ?? '');
  // svelte-ignore state_referenced_locally
  let picture = $state(metadata?.picture ?? '');
  // svelte-ignore state_referenced_locally
  let isPublic = $state(
    !!metadataEvent?.tags?.some((/** @type {string[]} */ t) => t[0] === 'public')
  );
  // svelte-ignore state_referenced_locally
  let isOpen = $state(!!metadataEvent?.tags?.some((/** @type {string[]} */ t) => t[0] === 'open'));

  let busy = $state(false);
  let confirmingDelete = $state(false);

  async function save() {
    const user = getActiveUser();
    if (!user) return;
    busy = true;
    try {
      await publishToGroupRelay(
        pool.relay(pointer.relay),
        buildEditGroupMetadataTemplate(pointer.id, { name, about, picture, isPublic, isOpen }),
        user
      );
      showToast(m.groups_settings_saved(), 'success');
      onClose();
    } catch (err) {
      console.error('groups: settings save failed', err);
      showToast(m.groups_settings_save_failed(), 'error');
    } finally {
      busy = false;
    }
  }

  function requestDelete() {
    confirmingDelete = true;
  }

  async function confirmDelete() {
    const user = getActiveUser();
    if (!user) return;
    busy = true;
    try {
      await publishToGroupRelay(
        pool.relay(pointer.relay),
        buildDeleteGroupTemplate(pointer.id),
        user
      );
      showToast(m.groups_settings_deleted(), 'success');
      onDeleted();
      onClose();
    } catch (err) {
      console.error('groups: settings delete failed', err);
      showToast(m.groups_settings_delete_failed(), 'error');
    } finally {
      busy = false;
    }
  }
</script>

<div class="modal-open modal" role="dialog">
  <div class="modal-box max-w-md">
    <button class="btn absolute top-3 right-3 btn-circle btn-ghost btn-sm" onclick={onClose}
      >✕</button
    >
    <h3 class="text-lg font-extrabold">{m.groups_settings_title()}</h3>

    <div class="mt-3 flex flex-col gap-3">
      <label class="form-control">
        <span class="label-text text-xs">{m.groups_create_name_label()}</span>
        <input
          type="text"
          class="input-bordered input input-sm"
          data-testid="group-edit-name"
          bind:value={name}
          disabled={busy}
        />
      </label>
      <label class="form-control">
        <span class="label-text text-xs">{m.groups_create_about_label()}</span>
        <textarea
          class="textarea-bordered textarea textarea-sm"
          data-testid="group-edit-about"
          bind:value={about}
          disabled={busy}
        ></textarea>
      </label>
      <label class="form-control">
        <span class="label-text text-xs">{m.groups_create_picture_label()}</span>
        <input
          type="text"
          class="input-bordered input input-sm"
          data-testid="group-edit-picture"
          bind:value={picture}
          disabled={busy}
        />
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="checkbox checkbox-sm"
          data-testid="group-edit-public"
          bind:checked={isPublic}
          disabled={busy}
        />
        {m.groups_create_public_toggle()}
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="checkbox checkbox-sm"
          data-testid="group-edit-open"
          bind:checked={isOpen}
          disabled={busy}
        />
        {m.groups_create_open_toggle()}
      </label>

      <button
        type="button"
        class="btn btn-sm btn-primary"
        data-testid="group-edit-save"
        disabled={busy}
        onclick={save}
      >
        {m.groups_settings_save()}
      </button>
    </div>

    <div class="mt-6 border-t border-base-300 pt-3">
      {#if confirmingDelete}
        <p class="mb-2 text-xs text-error">{m.groups_settings_delete_confirm()}</p>
        <button
          type="button"
          class="btn btn-sm btn-error"
          data-testid="group-delete-confirm"
          disabled={busy}
          onclick={confirmDelete}
        >
          {m.groups_settings_delete()}
        </button>
      {:else}
        <button
          type="button"
          class="btn text-error btn-outline btn-sm"
          data-testid="group-delete"
          disabled={busy}
          onclick={requestDelete}
        >
          {m.groups_settings_delete()}
        </button>
      {/if}
    </div>
  </div>
</div>
