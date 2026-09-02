<!--
  MemberActionsMenu — the per-row NIP-29 roster action kebab, extracted from
  GroupMembersModal's memberRow so MembersView can offer the same management
  inline on the members page (issue 7ca94a65: consolidate Members and Manage
  Members into one section). Same action set and put-user semantics as the
  modal rows; the caller decides visibility (admin viewer, non-self rows) and
  which actions fit the member's roster status.

  GroupMembersModal keeps its own copy of this markup: its two dialogs must be
  SIBLINGS of the modal-box (DaisyUI's translate/scale animation makes the box
  a containing block that would clip a nested fixed overlay), while here the
  dialogs can live right inside the component. Keep the action semantics in
  sync with the modal — the role-preserving rules themselves are shared via
  $lib/groups/roles.js.
-->
<script>
  import {
    buildPutUserTemplate,
    buildRemoveUserTemplate,
    publishToGroupRelay
  } from '$lib/groups/group-management.js';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { isPublisher, withPublisherRole, withoutPublisherRole } from '$lib/groups/roles.js';
  import { MoreIcon } from '$lib/components/icons';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   pointer: {id: string, relay: string},
   *   pubkey: string,
   *   name: string,
   *   roles?: string[],
   *   actions: { togglePublisher?: boolean, promote?: boolean, demote?: boolean, remove?: boolean },
   *   roleOptions?: string[],
   *   onRosterChanged?: () => void,
   *   onMemberAdded?: ((pubkey: string) => void | Promise<void>) | null
   * }}
   */
  let {
    pointer,
    pubkey,
    name,
    roles = [],
    actions,
    roleOptions = [],
    onRosterChanged,
    onMemberAdded = null
  } = $props();

  const getActiveUser = useActiveUser();

  let busy = $state(false);
  let roleDialogOpen = $state(false);
  let removeDialogOpen = $state(false);
  let roleDraft = $state('');

  // The kebab is DaisyUI's focus-driven dropdown, so it only closes when
  // focus leaves it — a dialog opened from a menu item would otherwise sit on
  // top of a menu that is still visibly open (GroupMembersModal does the same).
  const closeRowMenu = () => /** @type {HTMLElement | null} */ (document.activeElement)?.blur();

  /** @param {string[]} newRoles */
  async function putUser(newRoles) {
    const user = getActiveUser();
    if (!user) return;
    busy = true;
    try {
      await publishToGroupRelay(
        pool.relay(pointer.relay),
        buildPutUserTemplate(pointer.id, pubkey, newRoles),
        user
      );
      onRosterChanged?.();
      await onMemberAdded?.(pubkey);
    } catch (err) {
      console.error('groups: put-user failed', err);
      showToast(m.groups_members_action_failed(), 'error');
    } finally {
      busy = false;
    }
  }

  // A 9000 put-user REPLACES the member's whole role set, so promote/demote
  // carry the publisher role across — same rules as GroupMembersModal (see
  // the longer rationale there).
  const promote = () => putUser(isPublisher(roles) ? withPublisherRole(['admin']) : ['admin']);
  const demote = () => putUser(isPublisher(roles) ? withPublisherRole([]) : []);
  const togglePublisher = () =>
    putUser(isPublisher(roles) ? withoutPublisherRole(roles) : withPublisherRole(roles));

  function assignRole() {
    const role = roleDraft.trim();
    if (!role) return;
    roleDialogOpen = false;
    putUser([role]);
  }

  async function removeMember() {
    const user = getActiveUser();
    if (!user) return;
    removeDialogOpen = false;
    busy = true;
    try {
      await publishToGroupRelay(
        pool.relay(pointer.relay),
        buildRemoveUserTemplate(pointer.id, pubkey),
        user
      );
      onRosterChanged?.();
    } catch (err) {
      console.error('groups: remove-user failed', err);
      showToast(m.groups_members_action_failed(), 'error');
    } finally {
      busy = false;
    }
  }
</script>

<div class="dropdown dropdown-end shrink-0" data-testid="member-actions-menu" data-pubkey={pubkey}>
  <button
    tabindex="0"
    class="btn btn-circle btn-ghost btn-sm"
    aria-label={m.groups_members_row_menu({ name })}
  >
    <MoreIcon class_="w-5 h-5" />
  </button>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <ul
    tabindex="0"
    class="dropdown-content menu z-50 w-60 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
  >
    {#if actions.togglePublisher}
      <li>
        <button
          data-testid="member-toggle-publisher"
          data-pubkey={pubkey}
          disabled={busy}
          onclick={() => {
            closeRowMenu();
            togglePublisher();
          }}
        >
          {isPublisher(roles)
            ? m.groups_members_revoke_publisher()
            : m.groups_members_grant_publisher()}
        </button>
      </li>
    {/if}
    {#if actions.promote}
      <li>
        <button
          data-testid="member-promote"
          data-pubkey={pubkey}
          disabled={busy}
          onclick={() => {
            closeRowMenu();
            promote();
          }}
        >
          {m.groups_members_promote()}
        </button>
      </li>
    {/if}
    {#if actions.demote}
      <li>
        <button
          data-testid="member-demote"
          data-pubkey={pubkey}
          disabled={busy}
          onclick={() => {
            closeRowMenu();
            demote();
          }}
        >
          {m.groups_members_demote()}
        </button>
      </li>
    {/if}
    {#if roleOptions.length > 0}
      <li>
        <button
          data-testid="member-assign-role"
          data-pubkey={pubkey}
          disabled={busy}
          onclick={() => {
            closeRowMenu();
            roleDialogOpen = true;
          }}
        >
          {m.groups_members_assign_role_open()}
        </button>
      </li>
    {/if}
    {#if actions.remove}
      <div class="divider my-0"></div>
      <li>
        <button
          class="text-error"
          data-testid="member-remove"
          data-pubkey={pubkey}
          disabled={busy}
          onclick={() => {
            closeRowMenu();
            removeDialogOpen = true;
          }}
        >
          {m.groups_members_remove()}
        </button>
      </li>
    {/if}
  </ul>
</div>

{#if roleDialogOpen}
  {@const draft = roleDraft.trim()}
  <div class="modal-open modal" role="dialog">
    <div class="modal-box max-w-sm">
      <h3 class="text-lg font-extrabold">{m.groups_members_assign_role_title()}</h3>
      <p class="my-3 text-sm text-base-content/70">
        {m.groups_members_assign_role_body({ name })}
      </p>
      <input
        type="text"
        class="input-bordered input w-full"
        list="member-actions-roles-{pubkey}"
        placeholder={m.groups_members_role_placeholder()}
        aria-label={m.groups_members_role_placeholder()}
        data-testid="member-role-input"
        data-pubkey={pubkey}
        value={roleDraft}
        oninput={(e) => (roleDraft = /** @type {HTMLInputElement} */ (e.target).value)}
      />
      <datalist id="member-actions-roles-{pubkey}">
        {#each roleOptions as option (option)}
          <option value={option}></option>
        {/each}
      </datalist>
      <div class="modal-action">
        <button class="btn btn-ghost" onclick={() => (roleDialogOpen = false)}>
          {m.common_cancel()}
        </button>
        <button
          class="btn btn-primary"
          data-testid="member-assign-role-confirm"
          data-pubkey={pubkey}
          disabled={busy || !draft}
          onclick={assignRole}
        >
          {m.groups_members_assign_role()}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if removeDialogOpen}
  <div class="modal-open modal" role="dialog">
    <div class="modal-box max-w-sm text-center">
      <h3 class="text-lg font-extrabold">{m.groups_members_remove_confirm_title({ name })}</h3>
      <p class="my-3 text-sm text-base-content/70">
        {m.groups_members_remove_confirm_body({ name })}
      </p>
      <div class="modal-action justify-center">
        <button class="btn btn-ghost" onclick={() => (removeDialogOpen = false)}>
          {m.common_cancel()}
        </button>
        <button
          class="btn btn-error"
          data-testid="member-remove-confirm"
          data-pubkey={pubkey}
          disabled={busy}
          onclick={removeMember}
        >
          {m.groups_members_remove()}
        </button>
      </div>
    </div>
  </div>
{/if}
