<!--
  GroupMembersModal — Task 7. NIP-29 members-with-roles modal: lists the
  group's kind-39001 admins (their protocol role tags rendered as-is —
  arbitrary relay-defined strings, not a translatable enum) then its
  kind-39002 members (minus admin pubkeys), and lets an admin put-user
  (promote/demote/add) or remove-user against the group relay directly.

  No local roster mutation: every action calls onRosterChanged() and relies
  on GroupChat's rosterSeq bump to re-request 39001/39002 from the relay —
  the relay is the only source of truth for group membership.
-->
<script>
  import {
    buildPutUserTemplate,
    buildRemoveUserTemplate,
    publishToGroupRelay
  } from '$lib/groups/group-management.js';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getUserDisplayName } from '$lib/helpers/message-utils.js';
  import { unique } from '$lib/helpers/unique.js';
  import ContactSearchInput from '$lib/components/shared/ContactSearchInput.svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   pointer: {id: string, relay: string},
   *   metadata: any,
   *   admins: {pubkey: string, roles: string[]}[],
   *   members: Set<string>,
   *   myPubkey: string | null | undefined,
   *   isAdmin: boolean,
   *   roleOptions?: string[],
   *   onRosterChanged?: () => void,
   *   onClose: () => void
   * }}
   */
  let {
    pointer,
    metadata,
    admins,
    members,
    myPubkey,
    isAdmin,
    roleOptions = [],
    onRosterChanged,
    onClose
  } = $props();

  const getActiveUser = useActiveUser();

  const adminPubkeys = $derived(new Set(admins.map((a) => a.pubkey)));
  const memberPubkeys = $derived([...members].filter((p) => !adminPubkeys.has(p)));
  const getProfiles = useProfileMap(() => [...admins.map((a) => a.pubkey), ...memberPubkeys]);

  let busy = $state(false);

  /** @param {string} pubkey @param {string[]} roles */
  async function putUser(pubkey, roles) {
    const user = getActiveUser();
    if (!user) return;
    busy = true;
    try {
      await publishToGroupRelay(
        pool.relay(pointer.relay),
        buildPutUserTemplate(pointer.id, pubkey, roles),
        user
      );
      onRosterChanged?.();
    } catch (err) {
      console.error('groups: put-user failed', err);
      showToast(m.groups_members_action_failed(), 'error');
    } finally {
      busy = false;
    }
  }

  /** @param {string} pubkey */
  const addMember = (pubkey) => putUser(pubkey, []);
  // Promote uses the literal 'admin' role. The 39003 roles list is a
  // relay-level nicety (custom named roles beyond the bare admin
  // convention); wiring a picker for it is YAGNI until a relay in the field
  // actually announces custom roles.
  /** @param {string} pubkey */
  const promote = (pubkey) => putUser(pubkey, ['admin']);
  /** @param {string} pubkey */
  const demote = (pubkey) => putUser(pubkey, []);

  // Compact role-assign control (Task 8): one free-text-with-suggestions
  // input per row, same select+free-text pattern AccessTierEditor already
  // uses (a datalist-backed input serves as both at once) rather than a
  // separate <select> plus a separate text field. Only rendered when the
  // caller supplies roleOptions — existing promote/demote/add/remove
  // behavior is untouched when it's the [] default.
  /** @type {Record<string, string>} */
  let roleDrafts = $state({});

  /** @param {string} pubkey @param {string} value */
  function setRoleDraft(pubkey, value) {
    roleDrafts = { ...roleDrafts, [pubkey]: value };
  }

  /** @param {string} pubkey */
  function assignRole(pubkey) {
    const role = (roleDrafts[pubkey] ?? '').trim();
    if (!role) return;
    putUser(pubkey, [role]);
  }

  /** @param {string} pubkey */
  async function removeMember(pubkey) {
    const user = getActiveUser();
    if (!user) return;
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

<div class="modal-open modal" role="dialog">
  <div class="modal-box max-w-md">
    <button class="btn absolute top-3 right-3 btn-circle btn-ghost btn-sm" onclick={onClose}
      >✕</button
    >
    <h3 class="text-lg font-extrabold">{m.groups_members_title()}</h3>
    {#if metadata?.name}
      <p class="mb-1 text-xs text-base-content/60">{metadata.name}</p>
    {/if}

    {#if isAdmin && roleOptions.length > 0}
      <datalist id="group-members-role-options">
        {#each roleOptions as option (option)}
          <option value={option}></option>
        {/each}
      </datalist>
    {/if}

    <h4 class="mt-3 text-xs font-bold text-base-content/50 uppercase">
      {m.groups_members_admins_heading()}
    </h4>
    <div class="divide-y divide-base-300">
      {#each admins as admin (admin.pubkey)}
        {@const self = admin.pubkey === myPubkey}
        <div
          class="flex flex-wrap items-center gap-3 py-2"
          data-testid="admin-row"
          data-pubkey={admin.pubkey}
        >
          <ProfileAvatar
            pubkey={admin.pubkey}
            profile={getProfiles().get(admin.pubkey)}
            size="sm"
          />
          <span class="flex-1 truncate text-sm font-semibold">
            {getUserDisplayName(admin.pubkey, getProfiles().get(admin.pubkey))}
          </span>
          {#if admin.roles.length > 0}
            {#each unique(admin.roles) as role (role)}
              <span class="badge max-w-[7rem] truncate badge-ghost badge-sm" title={role}
                >{role}</span
              >
            {/each}
          {:else}
            <span class="badge badge-ghost badge-sm">admin</span>
          {/if}
          {#if isAdmin && roleOptions.length > 0 && !self}
            <input
              type="text"
              class="input-bordered input input-xs w-24"
              list="group-members-role-options"
              placeholder={m.groups_members_role_placeholder()}
              data-testid="member-role-input"
              data-pubkey={admin.pubkey}
              value={roleDrafts[admin.pubkey] ?? ''}
              oninput={(e) =>
                setRoleDraft(admin.pubkey, /** @type {HTMLInputElement} */ (e.target).value)}
            />
            <button
              class="btn btn-ghost btn-xs"
              data-testid="member-assign-role"
              data-pubkey={admin.pubkey}
              disabled={busy || !(roleDrafts[admin.pubkey] ?? '').trim()}
              onclick={() => assignRole(admin.pubkey)}
            >
              {m.groups_members_assign_role()}
            </button>
          {/if}
          {#if isAdmin && !self}
            <button
              class="btn btn-ghost btn-xs"
              data-testid="member-demote"
              data-pubkey={admin.pubkey}
              disabled={busy}
              onclick={() => demote(admin.pubkey)}
            >
              {m.groups_members_demote()}
            </button>
          {/if}
        </div>
      {/each}
    </div>

    <h4 class="mt-3 text-xs font-bold text-base-content/50 uppercase">
      {m.groups_members_members_heading()}
    </h4>
    <div class="divide-y divide-base-300">
      {#each memberPubkeys as pubkey (pubkey)}
        <div
          class="flex flex-wrap items-center gap-3 py-2"
          data-testid="member-row"
          data-pubkey={pubkey}
        >
          <ProfileAvatar {pubkey} profile={getProfiles().get(pubkey)} size="sm" />
          <span class="flex-1 truncate text-sm font-semibold">
            {getUserDisplayName(pubkey, getProfiles().get(pubkey))}
          </span>
          {#if isAdmin && roleOptions.length > 0}
            <input
              type="text"
              class="input-bordered input input-xs w-24"
              list="group-members-role-options"
              placeholder={m.groups_members_role_placeholder()}
              data-testid="member-role-input"
              data-pubkey={pubkey}
              value={roleDrafts[pubkey] ?? ''}
              oninput={(e) =>
                setRoleDraft(pubkey, /** @type {HTMLInputElement} */ (e.target).value)}
            />
            <button
              class="btn btn-ghost btn-xs"
              data-testid="member-assign-role"
              data-pubkey={pubkey}
              disabled={busy || !(roleDrafts[pubkey] ?? '').trim()}
              onclick={() => assignRole(pubkey)}
            >
              {m.groups_members_assign_role()}
            </button>
          {/if}
          {#if isAdmin}
            <button
              class="btn btn-ghost btn-xs"
              data-testid="member-promote"
              data-pubkey={pubkey}
              disabled={busy}
              onclick={() => promote(pubkey)}
            >
              {m.groups_members_promote()}
            </button>
            <button
              class="btn text-error btn-ghost btn-xs"
              data-testid="member-remove"
              data-pubkey={pubkey}
              disabled={busy}
              onclick={() => removeMember(pubkey)}
            >
              {m.groups_members_remove()}
            </button>
          {/if}
        </div>
      {/each}
    </div>

    {#if isAdmin}
      <div class="mt-3">
        <ContactSearchInput
          acceptPubkeyInput
          disabled={busy}
          placeholder={m.groups_members_add_placeholder()}
          exclude={[...members]}
          onselect={(/** @type {{ pubkey: string }} */ c) => addMember(c.pubkey)}
          onrawpubkey={(/** @type {string} */ hex) => addMember(hex)}
        />
      </div>
    {/if}
  </div>
</div>
