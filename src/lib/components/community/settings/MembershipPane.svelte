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
  import {
    pendingJoinRequests,
    readDismissedJoinRequests,
    writeDismissedJoinRequests
  } from '$lib/groups/join-requests.js';
  import { authenticateOnce, isAuthRequiredError } from '$lib/groups/relay-auth.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getUserDisplayName } from '$lib/helpers/message-utils.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
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

  // --- Beitrittsanfragen: NIP-29's spec-native application queue ----------
  // A bare kind-9021 on a CLOSED group is STORED by the relay (verified live
  // on groups.0xchat.com) until an admin answers with put-user. This loads
  // the stored requests off the root group's relay; pendingJoinRequests
  // drops everyone already on the roster, so approval empties the queue on
  // its own.
  /** @type {any[]} */
  let joinRequestEvents = $state.raw([]);
  let dismissedIds = $state.raw(/** @type {Set<string>} */ (new Set()));
  $effect(() => {
    dismissedIds = readDismissedJoinRequests(communityId);
  });
  let requestsSeq = $state(0);

  $effect(() => {
    requestsSeq; // re-run after a successful NIP-42 authenticate
    const pointer = roster.pointer;
    if (!pointer || !isAdmin) return;
    /** @type {any[]} */
    const collected = [];
    const sub = pool
      .relay(pointer.relay)
      .request({ kinds: [9021], '#h': [pointer.id], limit: 100 }, { timeout: 8000 })
      .subscribe({
        next: (/** @type {any} */ event) => {
          collected.push(event);
          joinRequestEvents = [...collected];
        },
        error: (/** @type {any} */ err) => {
          if (!isAuthRequiredError(err) || !activeUser?.signer) return;
          authenticateOnce(pool.relay(pointer.relay), activeUser.signer).then((response) => {
            if (response.ok) requestsSeq++;
          });
        }
      });
    return () => sub.unsubscribe();
  });

  const pendingRequests = $derived(
    pendingJoinRequests({
      events: joinRequestEvents,
      // Admins + the community's own seat count as "already in".
      members: new Set([
        ...roster.members,
        ...roster.admins.map((admin) => admin.pubkey),
        communityId
      ]),
      dismissed: dismissedIds
    })
  );
  const getRequestProfiles = useProfileMap(() => pendingRequests.map((row) => row.pubkey));

  let approving = $state('');

  /** @param {import('$lib/groups/join-requests.js').JoinRequestRow} row */
  async function approveRequest(row) {
    if (!activeUser || !roster.pointer || approving) return;
    approving = row.id;
    try {
      await putUserOn(roster.pointer, row.pubkey, [], /** @type {any} */ (activeUser));
      roster.refresh();
      // Same propagation as an invite-code join would get from the session
      // reconcile — immediately, since the approving admin is right here.
      await fanOutNewMember(row.pubkey);
      showToast(m.community_join_request_approved(), 'success');
    } catch (error) {
      console.error('join-request approval failed', error);
      showToast(
        m.community_join_request_approve_failed({
          reason: error instanceof Error ? error.message : String(error)
        }),
        'error'
      );
    } finally {
      approving = '';
    }
  }

  /** @param {import('$lib/groups/join-requests.js').JoinRequestRow} row */
  function ignoreRequest(row) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw Set, replaced wholesale (CLAUDE.md pattern)
    const next = new Set(dismissedIds);
    next.add(row.id);
    dismissedIds = next;
    writeDismissedJoinRequests(communityId, next);
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

      {#if pendingRequests.length > 0}
        <div class="divider"></div>

        <h3 class="text-sm font-bold">{m.community_join_requests_title()}</h3>
        <p class="text-sm text-base-content/70">{m.community_join_requests_lead()}</p>

        <div class="mt-2 flex flex-col gap-2">
          {#each pendingRequests as row (row.id)}
            <div
              class="flex items-center gap-3 rounded-lg bg-base-200 px-3 py-2"
              data-testid="join-request-row"
              data-pubkey={row.pubkey}
            >
              <ProfileAvatar
                pubkey={row.pubkey}
                profile={getRequestProfiles().get(row.pubkey)}
                size="sm"
              />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold">
                  {getUserDisplayName(row.pubkey, getRequestProfiles().get(row.pubkey))}
                </p>
                {#if row.reason}
                  <p class="truncate text-xs text-base-content/60 italic">{row.reason}</p>
                {/if}
              </div>
              <button
                class="btn btn-ghost btn-sm"
                data-testid="join-request-ignore"
                onclick={() => ignoreRequest(row)}
              >
                {m.community_join_requests_ignore()}
              </button>
              <button
                class="btn btn-sm btn-primary"
                data-testid="join-request-approve"
                disabled={!!approving}
                onclick={() => approveRequest(row)}
              >
                {m.community_join_requests_approve()}
              </button>
            </div>
          {/each}
        </div>
      {/if}
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
