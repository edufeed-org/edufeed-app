<!--
  MembershipPane — Task 8. Root-group roster management + application-form
  management for moderated communities: member/admin counts, a "Mitglieder
  verwalten" button that opens GroupMembersModal (Task 7) wired to the root
  group via useRootRoster, and a card to select/save/remove/create-default
  the community's application form (kind 30168, referenced by the
  `application` tag — community-membership.js).

  Owns its own useRootRoster subscription (called during init, per its
  header comment) rather than SettingsView hosting a second one; the roster
  role union is reported upward via the optional onRolesChanged callback so
  SettingsView can feed it to AccessTierEditor's roleSuggestions without a
  duplicate roster subscription living there too.

  Rendered by SettingsView only for moderated + owner (see there); this
  component itself does not re-check ownership beyond isAdmin gating on the
  roster/action controls.
-->
<script>
  import { useRootRoster } from '$lib/groups/root-roster.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { getCommunitySigner, isCommunityOwner } from '$lib/helpers/community-signer.js';
  import { useFormTemplates } from '$lib/stores/form-templates.svelte.js';
  import { parseFormTemplate, createDefaultMembershipForm } from '$lib/helpers/forms.js';
  import {
    parseApplicationRef,
    withApplicationRef,
    withoutApplicationRef
  } from '$lib/groups/community-membership.js';
  import { communityUpdateTemplate } from '$lib/groups/community-flips.js';
  import { publishCommunityUpdate } from '$lib/helpers/publishCommunityUpdate.js';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { getSeenRelays, getDisplayName } from 'applesauce-core/helpers';
  import { unique, uniqueBy } from '$lib/helpers/unique.js';
  import { showToast } from '$lib/helpers/toast';
  import { untrack } from 'svelte';
  import {
    buildCreateInviteTemplate,
    generateInviteCode,
    publishToGroupRelay
  } from '$lib/groups/group-management.js';
  import GroupMembersModal from '$lib/components/groups/GroupMembersModal.svelte';
  import ApplicationApprovals from '$lib/components/community/settings/ApplicationApprovals.svelte';
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

  const communitySigner = $derived.by(() => getCommunitySigner(communikeyEvent?.pubkey));

  const isAdmin = $derived(
    (!!activeUser && roster.admins.some((admin) => admin.pubkey === activeUser.pubkey)) ||
      isCommunityOwner(communityId)
  );

  // Union of every admin's roles + the bare 'admin' role, deduped — reported
  // upward so SettingsView can feed AccessTierEditor's roleSuggestions
  // without a second roster subscription there.
  const roleOptions = $derived(unique([...roster.admins.flatMap((a) => a.roles ?? []), 'admin']));
  $effect(() => {
    onRolesChanged?.(roleOptions);
  });

  let showMembersModal = $state(false);

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

  // --- Application form management ---------------------------------------

  const getFormTemplates = useFormTemplates(() => {
    const authors = communityId ? [communityId] : [];
    if (activeUser?.pubkey && activeUser.pubkey !== communityId) authors.push(activeUser.pubkey);
    return authors;
  });

  /** @param {any} template */
  function addressOf(template) {
    return `${template.kind}:${template.pubkey}:${parseFormTemplate(template).dTag}`;
  }

  const formOptions = $derived(
    uniqueBy(getFormTemplates(), (t) => addressOf(t)).map((t) => {
      const parsed = parseFormTemplate(t);
      return { address: addressOf(t), name: parsed.name || parsed.dTag };
    })
  );

  const applicationRef = $derived(parseApplicationRef(communikeyEvent));

  let selectedAddress = $state('');
  // Plain (non-$state) ref: the last address we synced FROM the prop,
  // mutated only inside the effect below (see CLAUDE.md's plain-let rule).
  // null means "never synced" — forces the first sync unconditionally so
  // the initial applicationRef is always picked up.
  let syncedAddress = /** @type {string | null} */ (null);
  $effect(() => {
    const nextAddress = applicationRef?.address ?? '';
    const current = untrack(() => selectedAddress);
    // Only overwrite the user's selection if they haven't touched it since
    // the last sync (current still equals what we last synced from).
    if (syncedAddress === null || current === syncedAddress) {
      selectedAddress = nextAddress;
    }
    syncedAddress = nextAddress;
  });

  /**
   * Relay hint for the application ref. Re-saving the address already
   * referenced keeps its known-good relay; a newly chosen address prefers
   * where we actually saw that template, else the community's own relay
   * (never GROUPS_RELAYS — the form must be findable where the community
   * lives, not on the NIP-29 groups relay).
   * @param {string} address
   * @returns {string | undefined}
   */
  function resolveApplicationRelay(address) {
    if (applicationRef?.address === address && applicationRef.relay) return applicationRef.relay;
    const template = getFormTemplates().find((t) => addressOf(t) === address);
    const seenRelays = template && getSeenRelays(template);
    return (seenRelays && [...seenRelays][0]) || getCommunikeyRelays()[0] || undefined;
  }

  let saving = $state(false);

  async function handleSaveApplication() {
    if (!communitySigner || !communikeyEvent || saving || !selectedAddress) return;
    saving = true;
    try {
      const template = communityUpdateTemplate(
        communikeyEvent,
        withApplicationRef(communikeyEvent.tags ?? [], {
          address: selectedAddress,
          relay: resolveApplicationRelay(selectedAddress)
        })
      );
      await publishCommunityUpdate(template, communitySigner);
      showToast(m.community_membership_pane_application_saved(), 'success');
    } catch (error) {
      console.error('settings: application form save failed', error);
      showToast(
        m.community_membership_pane_application_failed({
          reason: error instanceof Error ? error.message : String(error)
        }),
        'error'
      );
    } finally {
      saving = false;
    }
  }

  async function handleRemoveApplication() {
    if (!communitySigner || !communikeyEvent || saving) return;
    saving = true;
    try {
      const template = communityUpdateTemplate(
        communikeyEvent,
        withoutApplicationRef(communikeyEvent.tags ?? [])
      );
      await publishCommunityUpdate(template, communitySigner);
      selectedAddress = '';
      showToast(m.community_membership_pane_application_saved(), 'success');
    } catch (error) {
      console.error('settings: application form remove failed', error);
      showToast(
        m.community_membership_pane_application_failed({
          reason: error instanceof Error ? error.message : String(error)
        }),
        'error'
      );
    } finally {
      saving = false;
    }
  }

  async function handleCreateDefault() {
    if (!communitySigner || saving) return;
    saving = true;
    try {
      const signed = await createDefaultMembershipForm(communitySigner);
      await publishEvent(signed);
      eventStore.add(signed);
      selectedAddress = addressOf(signed);
    } catch (error) {
      console.error('settings: default application form creation failed', error);
      showToast(
        m.community_membership_pane_application_failed({
          reason: error instanceof Error ? error.message : String(error)
        }),
        'error'
      );
    } finally {
      saving = false;
    }
  }
</script>

<div class="card mb-6 bg-base-100 shadow-xl" data-testid="membership-pane">
  <div class="card-body">
    <h2 class="card-title">{m.community_membership_pane_title()}</h2>

    <div class="flex items-center justify-between gap-3">
      <p class="text-sm text-base-content/70">
        {m.community_membership_pane_member_count({ count: roster.members.size })}
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

    {#if isAdmin}
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
    {/if}

    <h3 class="text-sm font-bold">{m.community_membership_pane_application_title()}</h3>
    <p class="text-sm text-base-content/70">{m.community_membership_pane_application_lead()}</p>
    {#if !applicationRef}
      <p class="text-xs text-base-content/60">{m.community_membership_pane_application_none()}</p>
    {/if}

    <div class="mt-2 flex flex-wrap items-center gap-2">
      <select
        class="select-bordered select select-sm"
        data-testid="membership-application-select"
        value={selectedAddress}
        onchange={(e) => (selectedAddress = /** @type {HTMLSelectElement} */ (e.target).value)}
      >
        <option value="">—</option>
        {#each formOptions as option (option.address)}
          <option value={option.address}>{option.name}</option>
        {/each}
      </select>
      <button
        class="btn btn-sm btn-primary"
        data-testid="membership-application-save"
        disabled={!selectedAddress || saving}
        onclick={handleSaveApplication}
      >
        {m.community_membership_pane_application_save()}
      </button>
      {#if applicationRef}
        <button
          class="btn text-error btn-ghost btn-sm"
          data-testid="membership-application-remove"
          disabled={saving}
          onclick={handleRemoveApplication}
        >
          {m.community_membership_pane_application_remove()}
        </button>
      {/if}
      <button
        class="btn btn-outline btn-sm"
        data-testid="membership-application-create-default"
        disabled={!communitySigner || saving}
        onclick={handleCreateDefault}
      >
        {m.community_membership_pane_application_create_default()}
      </button>
    </div>
  </div>
</div>

{#if applicationRef && isAdmin}
  <ApplicationApprovals
    {communikeyEvent}
    {communityId}
    communityName={getDisplayName(profileEvent) || communityId}
    {roster}
  />
{/if}

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
    onClose={() => (showMembersModal = false)}
  />
{/if}
