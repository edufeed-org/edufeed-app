<!--
  MembershipPane — Task 8. Root-group roster management for moderated
  communities: member/admin counts, a "Mitglieder verwalten" button that
  opens GroupMembersModal (Task 7) wired to the root group via
  useRootRoster, and invite-code minting. Joining a moderated community is
  invite-code only — the structured application-form layer (Beitritts-
  formular, kind 30168 + encrypted 1069 copies + approvals queue) was
  removed as YAGNI (laoc, 2026-08-18); git history has the complete
  feature if it's ever needed.

  Owns its own useRootRoster subscription (called during init, per its
  header comment) rather than SettingsView hosting a second one; the roster
  role union is reported upward via the optional onRolesChanged callback so
  SettingsView can feed it to AccessTierEditor's roleSuggestions without a
  duplicate roster subscription living there too.

  Rendered by SettingsView for any signed-in user on a moderated community
  (no ownership check there — see there) — this component decides visibility
  from its own roster: isAdmin (active user in roster.admins ∪ the
  key-holding owner via isCommunityOwner) gates roster management, since a
  39001 admin's put-user ops are personal-key NIP-29 ops that need no
  community key. Renders nothing for a signed-in user who is neither.
-->
<script>
  import { useRootRoster } from '$lib/groups/root-roster.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { isCommunityOwner } from '$lib/helpers/community-signer.js';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { unique } from '$lib/helpers/unique.js';
  import { showToast } from '$lib/helpers/toast';
  import {
    buildCreateInviteTemplate,
    generateInviteCode,
    publishToGroupRelay
  } from '$lib/groups/group-management.js';
  import { stufe2Pointers, fanOutPlan } from '$lib/groups/area-members.js';
  import { useChannelRosters } from '$lib/groups/channel-rosters.svelte.js';
  import { channelKey } from '$lib/groups/community-pointer.js';
  import { putUserOn, fanOut } from '$lib/groups/roster-fanout.js';
  import JoinRequestsPanel from '$lib/components/community/settings/JoinRequestsPanel.svelte';
  import GroupMembersModal from '$lib/components/groups/GroupMembersModal.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   communikeyEvent: {pubkey?: string, tags?: string[][], content?: string, created_at?: number} | null | undefined,
   *   communityId: string,
   *   profileEvent?: any,
   *   onRolesChanged?: (roles: string[]) => void
   * }}
   */
  let { communikeyEvent, communityId, profileEvent, onRolesChanged } = $props();

  const getRoster = useRootRoster(() => communikeyEvent);
  const roster = $derived(getRoster());

  const getActiveUser = useActiveUser();
  const activeUser = $derived(getActiveUser());

  const isOwner = $derived(isCommunityOwner(communityId));
  const isAdmin = $derived(
    (!!activeUser && roster.admins.some((admin) => admin.pubkey === activeUser.pubkey)) || isOwner
  );

  // Union of every admin's roles + the bare 'admin' role, deduped — reported
  // upward so SettingsView can feed AccessTierEditor's roleSuggestions
  // without a second roster subscription there.
  const roleOptions = $derived(unique([...roster.admins.flatMap((a) => a.roles ?? []), 'admin']));
  $effect(() => {
    onRolesChanged?.(roleOptions);
  });

  let showMembersModal = $state(false);

  // Members-tier channel rosters — the fan-out targets when an admin adds a
  // member here. A channel's roster only counts once it has ANSWERED
  // (fanOutPlan skips unanswered ones), so a slow roster is skipped, never
  // double-added; the session reconcile (roster-reconcile.svelte.js) sweeps
  // up whatever this pass had to skip.
  const getChannelRosters = useChannelRosters(() => stufe2Pointers(communikeyEvent));

  /** @param {string} pubkey */
  async function fanOutNewMember(pubkey) {
    const user = activeUser;
    if (!user) return;
    const targets = fanOutPlan({
      pubkey,
      pointers: stufe2Pointers(communikeyEvent),
      membersByKey: getChannelRosters().membersByKey,
      adminsByKey: getChannelRosters().adminsByKey
    });
    if (targets.length === 0) return;
    const aggregate = await fanOut(
      targets,
      (pointer) => channelKey(pointer) ?? pointer.id,
      (pointer) => putUserOn(pointer, pubkey, [], /** @type {any} */ (user))
    );
    if (aggregate.failed.length > 0) {
      showToast(
        m.area_members_fanout_partial({
          failed: aggregate.failed.length,
          total: targets.length
        }),
        'warning'
      );
    }
  }

  // --- Invite code minting -------------------------------------------------

  let generatedCode = $state('');
  let creatingCode = $state(false);

  async function handleCreateInviteCode() {
    if (!activeUser || !roster.pointer || creatingCode) return;
    creatingCode = true;
    try {
      const code = generateInviteCode();
      const template = buildCreateInviteTemplate(roster.pointer.id, code);
      const relayConn = pool.relay(roster.pointer.relay);
      await publishToGroupRelay(relayConn, template, activeUser);
      generatedCode = code;
    } catch (error) {
      console.error('invite code creation failed', error);
      showToast(
        m.community_invite_failed({
          reason: error instanceof Error ? error.message : String(error)
        }),
        'error'
      );
    } finally {
      creatingCode = false;
    }
  }

  async function handleCopyInviteCode() {
    if (!generatedCode) return;
    if (!navigator.clipboard) {
      showToast(
        m.community_invite_failed({ reason: m.community_invite_clipboard_unavailable() }),
        'error'
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(generatedCode);
      showToast(m.community_invite_copied(), 'success');
    } catch (error) {
      console.error('clipboard copy failed', error);
      showToast(
        m.community_invite_failed({
          reason: error instanceof Error ? error.message : String(error)
        }),
        'error'
      );
    }
  }
</script>

{#if isAdmin}
  <div class="card mb-6 bg-base-100 shadow-xl" data-testid="membership-pane">
    <div class="card-body">
      <h2 class="card-title">{m.community_membership_pane_title()}</h2>

      <div class="flex items-center justify-between gap-3">
        <p class="text-sm text-base-content/70">
          {roster.members.size === 1
            ? m.community_membership_pane_member_count_one()
            : m.community_membership_pane_member_count({ count: roster.members.size })}
        </p>
        <button
          class="btn btn-outline btn-sm"
          data-testid="membership-manage-members"
          disabled={!roster.pointer}
          onclick={() => (showMembersModal = true)}
        >
          {m.community_membership_pane_manage()}
        </button>
      </div>

      <div class="divider"></div>

      <h3 class="text-sm font-bold">{m.community_invite_title()}</h3>
      <p class="text-sm text-base-content/70">{m.community_invite_hint()}</p>

      <div class="mt-2 flex flex-wrap items-center gap-2">
        <button
          class="btn btn-sm btn-primary"
          data-testid="membership-invite-create"
          disabled={!roster.pointer || creatingCode}
          onclick={handleCreateInviteCode}
        >
          {m.community_invite_create()}
        </button>

        {#if generatedCode}
          <div class="flex items-center gap-2">
            <code
              class="rounded bg-base-300 px-2 py-1 font-mono text-sm"
              data-testid="membership-invite-code"
            >
              {generatedCode}
            </code>
            <button
              class="btn btn-ghost btn-sm"
              data-testid="membership-invite-copy"
              onclick={handleCopyInviteCode}
            >
              {m.community_invite_copy()}
            </button>
          </div>
        {/if}
      </div>

      <div class="divider"></div>
      <JoinRequestsPanel {communikeyEvent} {communityId} {roster} showEmpty={true} />
    </div>
  </div>

  {#if showMembersModal && roster.pointer}
    <GroupMembersModal
      pointer={roster.pointer}
      metadata={{ name: getDisplayName(profileEvent) }}
      admins={roster.admins}
      members={roster.members}
      myPubkey={activeUser?.pubkey}
      {isAdmin}
      {roleOptions}
      onRosterChanged={roster.refresh}
      onMemberAdded={fanOutNewMember}
      onClose={() => (showMembersModal = false)}
    />
  {/if}
{/if}
