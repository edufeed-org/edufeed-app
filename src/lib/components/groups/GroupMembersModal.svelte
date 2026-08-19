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
    buildCreateInviteTemplate,
    generateInviteCode,
    publishToGroupRelay
  } from '$lib/groups/group-management.js';
  import { sendWrappedDm } from '$lib/services/wrapped-dm.js';
  import { buildGroupInviteMessage } from '$lib/groups/invite-message.js';
  import { fetchRelaySelf } from '$lib/groups/relay-self.js';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getUserDisplayName } from '$lib/helpers/message-utils.js';
  import { unique } from '$lib/helpers/unique.js';
  import { roleLabel } from '$lib/groups/role-labels.js';
  import ContactSearchInput from '$lib/components/shared/ContactSearchInput.svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { showToast } from '$lib/helpers/toast';
  import { nip19 } from 'nostr-tools';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   pointer: {id: string, relay: string},
   *   metadata: any,
   *   communityId?: string | null,
   *   admins: {pubkey: string, roles: string[]}[],
   *   members: Set<string>,
   *   myPubkey: string | null | undefined,
   *   isAdmin: boolean,
   *   roleOptions?: string[],
   *   onRosterChanged?: () => void,
   *   onMemberAdded?: ((pubkey: string) => void | Promise<void>) | null,
   *   onClose: () => void
   * }}
   */
  let {
    pointer,
    metadata,
    communityId = null,
    admins,
    members,
    myPubkey,
    isAdmin,
    roleOptions = [],
    onRosterChanged,
    onClose,
    onMemberAdded = null
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
      // AFTER the roster refresh kick-off: the caller may fan the fresh
      // member out to further groups (MembershipPane → members-tier
      // channels); a failing fan-out must not mask the successful add.
      await onMemberAdded?.(pubkey);
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

  // Task A6: a second, consent-based way to add someone besides the instant
  // put-user above — mint a single-use NIP-29 invite code (9009, legal only
  // on a CLOSED group — the root group, always the case at this modal's real
  // call site) and deliver it as a NIP-17 DM. The recipient accepts by
  // clicking join on the community page (prefilled code), not by us
  // put-user'ing them on their behalf.
  /** @type {'direct' | 'dm'} */
  let addMode = $state('direct');
  let inviteNpub = $state('');
  let inviteError = $state('');
  let sendingInvite = $state(false);

  /** @param {string} value @returns {string | null} hex pubkey, or null if not a valid npub */
  function decodeNpub(value) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const decoded = nip19.decode(trimmed);
      return decoded.type === 'npub' ? /** @type {string} */ (decoded.data) : null;
    } catch {
      return null;
    }
  }

  async function sendInvite() {
    const hex = decodeNpub(inviteNpub);
    if (!hex) {
      inviteError = m.group_invite_dm_invalid_npub();
      return;
    }
    const user = getActiveUser();
    // communityId is required to build the join URL's npub — the toggle
    // that reaches this pane is hidden without one (see template), so this
    // is a defensive no-op, not a user-facing path.
    if (!user || !communityId) return;
    inviteError = '';
    sendingInvite = true;
    try {
      // Mint first: a failure here means nothing was created — the generic
      // failure toast is correct and there is no code to hand over.
      /** @type {string} */
      let code;
      try {
        // A fresh code per send — single-use, one code = one person.
        code = generateInviteCode();
        await publishToGroupRelay(
          pool.relay(pointer.relay),
          buildCreateInviteTemplate(pointer.id, code),
          user
        );
      } catch (err) {
        console.error('groups: invite code mint failed', err);
        const reason = err instanceof Error ? err.message : String(err);
        showToast(m.group_invite_dm_failed({ reason }), 'error');
        return;
      }

      // The mint above already succeeded — the code is real and single-use.
      // A failure past this point must NOT reuse the generic failure toast:
      // that code is now orphaned (minted but never delivered), and the
      // admin needs it to hand over manually.
      try {
        // ?view=channels was dropped (controller ruling, 2026-08-19):
        // CommunityProfileHero — the only place reading ?join= — mounts
        // inside HomeView, not the channels view that param would route to.
        const npub = nip19.npubEncode(communityId);
        const joinUrl = `${location.origin}/c/${npub}?join=${code}`;

        // Cross-client naddr line is best-effort: a relay that won't answer
        // NIP-11 (or has no `self`) just means the DM ships without it —
        // the join URL alone is still a complete invite.
        const self = await fetchRelaySelf(pointer.relay);
        const naddr = self
          ? `${nip19.naddrEncode({
              kind: 39000,
              pubkey: self,
              identifier: pointer.id,
              relays: [pointer.relay]
            })}?invite=${code}`
          : null;

        const message = buildGroupInviteMessage({
          communityName: metadata?.name || '',
          joinUrl,
          naddr
        });
        await sendWrappedDm([hex], message);
        showToast(m.group_invite_dm_sent(), 'success');
        inviteNpub = '';
      } catch (err) {
        console.error('groups: dm invite send failed after a successful mint', err);
        showToast(m.group_invite_dm_failed_after_mint({ code }), 'error');
      }
    } finally {
      sendingInvite = false;
    }
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
                >{roleLabel(role)}</span
              >
            {/each}
          {:else}
            <span class="badge badge-ghost badge-sm">{roleLabel('admin')}</span>
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
        <div class="mb-2 flex gap-2">
          <button
            class="btn {addMode === 'direct' ? 'btn-primary' : 'btn-ghost'}"
            data-testid="add-mode-direct"
            onclick={() => (addMode = 'direct')}
          >
            {m.groups_members_add_direct_action()}
          </button>
          {#if communityId}
            <!-- Minting is root-group-only (a create-invite on an open
                 channel is rejected by the relay) — GroupMembersModal is
                 also used per-channel (GroupChat.svelte), which passes no
                 communityId. Hiding the toggle there, rather than trying to
                 detect root-vs-channel, keeps a channel context down to
                 direct-add only. -->
            <button
              class="btn {addMode === 'dm' ? 'btn-primary' : 'btn-ghost'}"
              data-testid="add-mode-dm"
              onclick={() => (addMode = 'dm')}
            >
              {m.group_invite_dm_action()}
            </button>
          {/if}
        </div>

        {#if addMode === 'dm' && communityId}
          <div class="flex flex-col gap-2">
            <input
              type="text"
              class="input-bordered input input-sm w-full"
              placeholder={m.group_invite_dm_npub_placeholder()}
              aria-label={m.group_invite_dm_npub_placeholder()}
              data-testid="dm-invite-npub-input"
              disabled={sendingInvite}
              value={inviteNpub}
              oninput={(e) => (inviteNpub = /** @type {HTMLInputElement} */ (e.target).value)}
            />
            {#if inviteError}
              <span class="text-xs text-error" data-testid="dm-invite-error">{inviteError}</span>
            {/if}
            <button
              class="btn btn-primary"
              data-testid="dm-invite-send"
              disabled={sendingInvite || !inviteNpub.trim()}
              onclick={sendInvite}
            >
              {#if sendingInvite}
                <span class="loading loading-xs loading-spinner"></span>
              {/if}
              {m.group_invite_dm_send()}
            </button>
          </div>
        {:else}
          <ContactSearchInput
            acceptPubkeyInput
            disabled={busy}
            placeholder={m.groups_members_add_placeholder()}
            exclude={[...members]}
            onselect={(/** @type {{ pubkey: string }} */ c) => addMember(c.pubkey)}
            onrawpubkey={(/** @type {string} */ hex) => addMember(hex)}
          />
        {/if}
      </div>
    {/if}
  </div>
</div>
