<!--
  Create a NIP-29 channel directly on a host relay — the relay page's own
  door, next to the community attach modal's create sub-mode. The relay is
  fixed by the page, so there is no relay field here; whether THIS user may
  create is the relay's call, and its refusal reason surfaces as the toast.

  On success the group is mirrored into the personal kind-10009 list (so it
  roams) and the user lands in the new channel.
-->
<script>
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { createGroupOnRelay, generateGroupId } from '$lib/groups/group-management.js';
  import { updatePersonalGroupsList } from '$lib/groups/personal-groups-list.js';
  import { groupHref } from '$lib/groups/groups.js';
  import { relayLabel } from '$lib/groups/relay-directory.js';
  import GroupExplainer from '$lib/components/groups/GroupExplainer.svelte';
  import { goto } from '$app/navigation';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  /** @type {{relay: string, onClose: () => void}} */
  let { relay, onClose } = $props();

  const getActiveUser = useActiveUser();

  let name = $state('');
  let about = $state('');
  let picture = $state('');
  let isPublic = $state(false);
  let isOpen = $state(false);
  let busy = $state(false);
  let explainerOpen = $state(false);

  const disabled = $derived(busy || !name.trim() || !getActiveUser()?.signer);

  async function create() {
    const user = getActiveUser();
    if (disabled || !user) return;
    busy = true;
    try {
      const id = generateGroupId();
      await createGroupOnRelay({
        relayConn: pool.relay(relay),
        id,
        metadata: { name: name.trim(), about, picture, isPublic, isOpen },
        user
      });
      await updatePersonalGroupsList(user, { add: { id, relay } });
      showToast(m.groups_create_here_success(), 'success');
      onClose();
      goto(groupHref({ id, relay }));
    } catch (error) {
      console.error('groups: create on relay failed', error);
      showToast(m.groups_create_failed(), 'error');
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
    <h3 class="text-lg font-extrabold">{m.groups_create_here_title()}</h3>
    <p class="mt-1 mb-4 text-xs text-base-content/60">
      {relayLabel(relay)} ·
      <button
        type="button"
        class="link link-hover"
        data-testid="group-explainer-open"
        onclick={() => (explainerOpen = true)}
      >
        {m.groups_explainer_link()}
      </button>
    </p>

    <label class="mb-1 block text-xs text-base-content/60" for="group-create-name">
      {m.groups_create_name_label()}
    </label>
    <input
      id="group-create-name"
      class="input-bordered input input-sm w-full"
      data-testid="group-create-name"
      bind:value={name}
      disabled={busy}
    />

    <label class="mt-3 mb-1 block text-xs text-base-content/60" for="group-create-about">
      {m.groups_create_about_label()}
    </label>
    <textarea
      id="group-create-about"
      class="textarea-bordered textarea w-full textarea-sm"
      data-testid="group-create-about"
      rows="2"
      bind:value={about}
      disabled={busy}
    ></textarea>

    <label class="mt-3 mb-1 block text-xs text-base-content/60" for="group-create-picture">
      {m.groups_create_picture_label()}
    </label>
    <input
      id="group-create-picture"
      class="input-bordered input input-sm w-full"
      data-testid="group-create-picture"
      bind:value={picture}
      disabled={busy}
    />

    <label class="mt-3 flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        class="toggle toggle-sm"
        data-testid="group-create-public"
        bind:checked={isPublic}
        disabled={busy}
      />
      {m.groups_create_public_toggle()}
    </label>
    <label class="mt-2 flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        class="toggle toggle-sm"
        data-testid="group-create-open"
        bind:checked={isOpen}
        disabled={busy}
      />
      {m.groups_create_open_toggle()}
    </label>

    <div class="modal-action">
      <button class="btn btn-ghost" onclick={onClose}>{m.concord_cancel()}</button>
      <button
        class="btn btn-neutral"
        data-testid="group-create-confirm"
        {disabled}
        onclick={create}
      >
        {#if busy}<span class="loading loading-xs loading-spinner"></span>{/if}
        {m.groups_create_here_action()}
      </button>
    </div>
  </div>
</div>

{#if explainerOpen}
  <GroupExplainer onClose={() => (explainerOpen = false)} />
{/if}
