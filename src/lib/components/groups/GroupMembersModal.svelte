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
  import { roleLabel } from '$lib/groups/role-labels.js';
  import {
    isPublisher,
    isPublisherOnly,
    withPublisherRole,
    withoutPublisherRole
  } from '$lib/groups/roles.js';
  import AddMemberControl from '$lib/components/groups/AddMemberControl.svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { MoreIcon } from '$lib/components/icons';
  import { showToast } from '$lib/helpers/toast';
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

  // NIP-29 has one list for every role holder (39001), so publishers arrive
  // mixed in with the moderators. Split them for display: someone who both
  // moderates and publishes stays under Admins — the stronger role wins — and
  // a role holder with no roles at all (some relays seat the creator that
  // way) also stays an admin.
  const publisherRows = $derived(admins.filter((a) => isPublisherOnly(a.roles)));
  const adminRows = $derived(admins.filter((a) => !isPublisherOnly(a.roles)));

  /** @param {string} pubkey */
  const rolesOf = (pubkey) => admins.find((a) => a.pubkey === pubkey)?.roles ?? [];

  /** @param {string} pubkey */
  const nameOf = (pubkey) => getUserDisplayName(pubkey, getProfiles().get(pubkey));

  let busy = $state(false);

  // The two row actions that need more than a click — a free-text role and a
  // destructive removal — open their own small dialog instead of expanding
  // inline (CLAUDE.md's modal grammar). Both hold the target pubkey.
  /** @type {string | null} */
  let roleDialogPubkey = $state(null);
  /** @type {string | null} */
  let removeDialogPubkey = $state(null);

  // The row kebab is DaisyUI's focus-driven dropdown, so it only closes when
  // focus leaves it — a dialog opened from a menu item would otherwise sit on
  // top of a menu that is still visibly open (EventContextMenu does the same).
  const closeRowMenu = () => /** @type {HTMLElement | null} */ (document.activeElement)?.blur();

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

  // Promote uses the literal 'admin' role. The 39003 roles list is a
  // relay-level nicety (custom named roles beyond the bare admin
  // convention); wiring a picker for it is YAGNI until a relay in the field
  // actually announces custom roles.
  //
  // A 9000 put-user REPLACES the member's whole role set, so promote/demote
  // carry the publisher role across instead of sending a bare ['admin'] / [] —
  // otherwise promoting a publisher would silently revoke their publishing
  // rights, and demoting an admin-publisher would too.
  //
  // Deliberately publisher-only: custom free-text roles are still wiped by a
  // demote, matching the assign-role input right beside it, which has always
  // replaced the whole set. The publisher role is the one with its own
  // grant/revoke control and its own meaning to `access` gating, so it is the
  // one that has to survive an unrelated action.
  /** @param {string} pubkey */
  const promote = (pubkey) =>
    putUser(pubkey, isPublisher(rolesOf(pubkey)) ? withPublisherRole(['admin']) : ['admin']);
  /** @param {string} pubkey */
  const demote = (pubkey) =>
    putUser(pubkey, isPublisher(rolesOf(pubkey)) ? withPublisherRole([]) : []);

  /** @param {string} pubkey */
  function togglePublisher(pubkey) {
    const current = rolesOf(pubkey);
    putUser(
      pubkey,
      isPublisher(current) ? withoutPublisherRole(current) : withPublisherRole(current)
    );
  }

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
    roleDialogPubkey = null;
    putUser(pubkey, [role]);
  }

  /** @param {string} pubkey */
  async function removeMember(pubkey) {
    const user = getActiveUser();
    if (!user) return;
    removeDialogPubkey = null;
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

<!--
  One row shape for all three sections: identity on the left, role chips, and
  every admin action folded into a trailing kebab. The actions are rendered
  unconditionally into the dropdown (DaisyUI's focus-driven form, as in
  EventContextMenu) rather than behind an {#if open} — a wrapping flex line of
  five text buttons is what made this modal read as unstyled, and btn-xs text
  labels are ruled out by CLAUDE.md's Buttons section.
-->
{#snippet memberRow(
  /** @type {string} */ pubkey,
  /** @type {string[]} */ roles,
  /** @type {string} */ testid,
  /** @type {{ togglePublisher?: boolean, promote?: boolean, demote?: boolean, remove?: boolean }} */ actions
)}
  {@const self = pubkey === myPubkey}
  {@const canAssignRole = isAdmin && roleOptions.length > 0 && !self}
  {@const hasMenu =
    isAdmin &&
    !self &&
    (canAssignRole ||
      actions.togglePublisher ||
      actions.promote ||
      actions.demote ||
      actions.remove)}
  <div class="flex items-center gap-3 py-2" data-testid={testid} data-pubkey={pubkey}>
    <ProfileAvatar {pubkey} profile={getProfiles().get(pubkey)} size="sm" />
    <span class="min-w-0 flex-1 truncate text-sm font-semibold">{nameOf(pubkey)}</span>
    <div class="flex shrink-0 items-center gap-1">
      {#if roles.length > 0}
        {#each unique(roles) as role (role)}
          <span class="badge max-w-[7rem] truncate badge-ghost badge-sm" title={role}
            >{roleLabel(role)}</span
          >
        {/each}
      {:else if testid === 'admin-row'}
        <span class="badge badge-ghost badge-sm">{roleLabel('admin')}</span>
      {/if}
      {#if self}
        <span class="badge badge-ghost badge-sm opacity-60">{m.groups_members_self_badge()}</span>
      {/if}
    </div>
    {#if hasMenu}
      <div class="dropdown dropdown-end shrink-0">
        <button
          tabindex="0"
          class="btn btn-circle btn-ghost btn-sm"
          aria-label={m.groups_members_row_menu({ name: nameOf(pubkey) })}
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
                  togglePublisher(pubkey);
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
                  promote(pubkey);
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
                  demote(pubkey);
                }}
              >
                {m.groups_members_demote()}
              </button>
            </li>
          {/if}
          {#if canAssignRole}
            <li>
              <button
                data-testid="member-assign-role"
                data-pubkey={pubkey}
                disabled={busy}
                onclick={() => {
                  closeRowMenu();
                  roleDialogPubkey = pubkey;
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
                  removeDialogPubkey = pubkey;
                }}
              >
                {m.groups_members_remove()}
              </button>
            </li>
          {/if}
        </ul>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet sectionHeading(/** @type {string} */ label, /** @type {number} */ count)}
  <h4 class="mt-4 flex items-center gap-2 text-xs font-bold text-base-content/50 uppercase">
    <span>{label}</span>
    <span class="font-mono text-sm text-base-content/40 normal-case">{count}</span>
  </h4>
{/snippet}

<div class="modal-open modal" role="dialog">
  <!-- max-w-2xl (not the max-w-lg most modals use): three role sections plus
       badge columns and row kebabs need the width, and the laoc 2026-08-27
       report was literally "the modal is too small". -->
  <div class="modal-box max-w-2xl">
    <button class="btn absolute top-3 right-3 btn-circle btn-ghost btn-sm" onclick={onClose}
      >✕</button
    >
    <h3 class="text-lg font-extrabold">{m.groups_members_title()}</h3>
    {#if metadata?.name}
      <p class="text-xs text-base-content/60">{metadata.name}</p>
    {/if}

    {#if isAdmin && roleOptions.length > 0}
      <datalist id="group-members-role-options">
        {#each roleOptions as option (option)}
          <option value={option}></option>
        {/each}
      </datalist>
    {/if}

    {@render sectionHeading(m.groups_members_admins_heading(), adminRows.length)}
    <div class="divide-y divide-base-300">
      {#each adminRows as admin (admin.pubkey)}
        {@render memberRow(admin.pubkey, admin.roles, 'admin-row', {
          togglePublisher: true,
          demote: true
        })}
      {/each}
    </div>

    {#if publisherRows.length > 0}
      {@render sectionHeading(m.groups_members_publishers_heading(), publisherRows.length)}
      <div class="divide-y divide-base-300">
        {#each publisherRows as publisher (publisher.pubkey)}
          {@render memberRow(publisher.pubkey, publisher.roles, 'publisher-row', {
            togglePublisher: true,
            promote: true,
            remove: true
          })}
        {/each}
      </div>
    {/if}

    {@render sectionHeading(m.groups_members_members_heading(), memberPubkeys.length)}
    <div class="divide-y divide-base-300">
      {#each memberPubkeys as pubkey (pubkey)}
        {@render memberRow(pubkey, [], 'member-row', {
          togglePublisher: true,
          promote: true,
          remove: true
        })}
      {/each}
      {#if memberPubkeys.length === 0}
        <p class="py-3 text-sm text-base-content/50">{m.groups_members_empty()}</p>
      {/if}
    </div>

    {#if isAdmin}
      <div class="mt-4">
        <AddMemberControl
          {pointer}
          {metadata}
          {communityId}
          {members}
          {onRosterChanged}
          {onMemberAdded}
        />
      </div>
    {/if}
  </div>
  <div class="modal-backdrop">
    <button onclick={onClose} aria-label={m.common_cancel()}></button>
  </div>
</div>

<!-- Both dialogs are SIBLINGS of the modal above, never nested inside its
     .modal-box: DaisyUI animates translate/scale on that box, which makes it a
     containing block and would clip a nested fixed-position overlay
     (ChannelMembersModal does the same). -->
{#if roleDialogPubkey}
  {@const pubkey = roleDialogPubkey}
  {@const draft = (roleDrafts[pubkey] ?? '').trim()}
  <div class="modal-open modal" role="dialog">
    <div class="modal-box max-w-sm">
      <h3 class="text-lg font-extrabold">{m.groups_members_assign_role_title()}</h3>
      <p class="my-3 text-sm text-base-content/70">
        {m.groups_members_assign_role_body({ name: nameOf(pubkey) })}
      </p>
      <input
        type="text"
        class="input-bordered input w-full"
        list="group-members-role-options"
        placeholder={m.groups_members_role_placeholder()}
        aria-label={m.groups_members_role_placeholder()}
        data-testid="member-role-input"
        data-pubkey={pubkey}
        value={roleDrafts[pubkey] ?? ''}
        oninput={(e) => setRoleDraft(pubkey, /** @type {HTMLInputElement} */ (e.target).value)}
      />
      <div class="modal-action">
        <button class="btn btn-ghost" onclick={() => (roleDialogPubkey = null)}>
          {m.common_cancel()}
        </button>
        <button
          class="btn btn-primary"
          data-testid="member-assign-role-confirm"
          data-pubkey={pubkey}
          disabled={busy || !draft}
          onclick={() => assignRole(pubkey)}
        >
          {m.groups_members_assign_role()}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if removeDialogPubkey}
  {@const pubkey = removeDialogPubkey}
  {@const name = nameOf(pubkey)}
  <div class="modal-open modal" role="dialog">
    <div class="modal-box max-w-sm text-center">
      <h3 class="text-lg font-extrabold">{m.groups_members_remove_confirm_title({ name })}</h3>
      <p class="my-3 text-sm text-base-content/70">
        {m.groups_members_remove_confirm_body({ name })}
      </p>
      <div class="modal-action justify-center">
        <button class="btn btn-ghost" onclick={() => (removeDialogPubkey = null)}>
          {m.common_cancel()}
        </button>
        <button
          class="btn btn-error"
          data-testid="member-remove-confirm"
          data-pubkey={pubkey}
          disabled={busy}
          onclick={() => removeMember(pubkey)}
        >
          {m.groups_members_remove()}
        </button>
      </div>
    </div>
  </div>
{/if}
