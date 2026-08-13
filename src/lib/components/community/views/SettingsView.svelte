<script>
  import { SettingsIcon } from '$lib/components/icons';
  import { leaveCommunity } from '$lib/helpers/community';
  import { useCommunityMembership } from '$lib/stores/joined-communities-list.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { showToast } from '$lib/helpers/toast';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import FormLinkManager from '$lib/components/forms/FormLinkManager.svelte';
  // Concord submodules imported DIRECTLY (never the barrel) — the convention
  // every Concord call site follows (see CLAUDE.md's Concord section).
  import { useConcordCommunity } from '$lib/concord/community.svelte.js';
  import { concordAreaDisplayName } from '$lib/concord/unlinked-areas.js';
  import { detachConcordArea } from '$lib/concord/attach.js';
  import { getCommunitySigner, isCommunityOwner } from '$lib/helpers/community-signer.js';
  import ConcordAreaBadge from '$lib/components/shared/ConcordAreaBadge.svelte';
  import AreaAttachModal from '$lib/components/community/channels/AreaAttachModal.svelte';
  import ChannelCreateWizard from '$lib/components/community/channels/ChannelCreateWizard.svelte';
  import AccessTierEditor from '$lib/components/community/settings/AccessTierEditor.svelte';
  import MembershipPane from '$lib/components/community/settings/MembershipPane.svelte';
  // Community-type flips (open <-> moderated; closed never transitions) — see
  // docs/nips/communikey-groups.md and src/lib/groups/community-flips.js.
  import { deriveCommunityType } from '$lib/groups/community-membership.js';
  import { parseGroupPointers } from '$lib/groups/community-pointer.js';
  import {
    buildFlipToModeratedTags,
    buildFlipToOpenTags,
    communityUpdateTemplate
  } from '$lib/groups/community-flips.js';
  import {
    provisionRootGroup,
    readRootGroupMarker,
    writeRootGroupMarker,
    clearRootGroupMarker
  } from '$lib/groups/provision-root-group.js';
  import { moderatedCreationAvailable } from '$lib/groups/feature.js';
  import { publishCommunityUpdate } from '$lib/helpers/publishCommunityUpdate.js';
  import { getGroupsRelays } from '$lib/helpers/relay-helper.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { unique } from '$lib/helpers/unique.js';
  import * as m from '$lib/paraglide/messages';

  let { communityId, communikeyEvent, profileEvent } = $props();

  // Roster role suggestions (Task 8): MembershipPane owns the ONE
  // useRootRoster subscription and reports its role union upward so
  // AccessTierEditor's roleSuggestions doesn't need a second one.
  let roleSuggestions = $state(/** @type {string[]} */ ([]));

  // "Privater Bereich" card (design spec 2026-07-28): owner-only home for the
  // create/attach/detach flows. The Kanäle-tab founding pane stays as a
  // shortcut; this card is the discoverable entry point.
  const getConcord = useConcordCommunity(() => communikeyEvent);
  const concordArea = $derived(getConcord());
  /** @type {'attach' | 'create' | 'detach' | null} */
  let concordOverlay = $state(null);
  let detaching = $state(false);

  const linkedAreaName = $derived.by(() => {
    if (concordArea.community) return concordAreaDisplayName(concordArea.community);
    return concordArea.pointer?.communityId.slice(0, 12) ?? '';
  });

  // Same signer-resolution pattern as ChannelCreateWizard/EditCommunityModal.
  // Shared by the Concord detach flow and the Typ-pane flips below — both
  // sign a rewritten 10222 with the community's own key.
  const communitySigner = $derived.by(() => getCommunitySigner(communikeyEvent?.pubkey));

  async function handleDetach() {
    if (detaching) return;
    detaching = true;
    try {
      await detachConcordArea({ communikeyEvent, communitySigner });
      showToast(m.concord_settings_detached_toast(), 'success');
      concordOverlay = null;
    } catch (error) {
      console.error('concord: detach failed', error);
      showToast(m.concord_settings_detach_failed(), 'error');
    } finally {
      detaching = false;
    }
  }

  // "Community-Typ" card (design spec Task 6): owner-only open<->moderated
  // flips. Community type is DERIVED from the 10222's pointer tags, never
  // declared — see deriveCommunityType. Closed communities never transition.
  const communityType = $derived(deriveCommunityType(communikeyEvent));
  const channelNames = $derived.by(() =>
    unique(parseGroupPointers(communikeyEvent).map((pointer) => pointer.name || pointer.id))
  );

  /** @type {'flip-to-moderated' | 'flip-to-open' | null} */
  let typeOverlay = $state(null);
  let flipping = $state(false);

  function openFlipToModerated() {
    typeOverlay = 'flip-to-moderated';
  }

  function openFlipToOpen() {
    typeOverlay = 'flip-to-open';
  }

  function closeTypeOverlay() {
    if (flipping) return;
    typeOverlay = null;
  }

  async function handleFlipToModerated() {
    if (flipping || !communitySigner || !activeUser) return;
    flipping = true;
    try {
      // Root group provisioning runs with the HUMAN's own signer (same
      // reasoning as CreateCommunityModal's moderated branch), not the
      // community signer — it may be a separate keypair.
      const pointer = await provisionRootGroup({
        relay: getGroupsRelays()[0],
        name: getDisplayName(profileEvent) || 'Community',
        user: { pubkey: activeUser.pubkey, signer: activeUser.signer },
        existingId: readRootGroupMarker(communityId)
      });
      writeRootGroupMarker(communityId, pointer.id);

      const template = communityUpdateTemplate(
        communikeyEvent,
        buildFlipToModeratedTags(communikeyEvent.tags, pointer)
      );
      await publishCommunityUpdate(template, communitySigner);
      // Marker only cleared once the 10222 actually points at the group —
      // if the publish above fails, re-running the flip must reuse it.
      clearRootGroupMarker(communityId);
      showToast(m.community_views_settings_flip_done(), 'success');
      typeOverlay = null;
    } catch (error) {
      console.error('settings: flip to moderated failed', error);
      showToast(
        m.community_views_settings_flip_failed({
          reason: error instanceof Error ? error.message : String(error)
        }),
        'error'
      );
    } finally {
      flipping = false;
    }
  }

  async function handleFlipToOpen() {
    if (flipping || !communitySigner) return;
    flipping = true;
    try {
      const template = communityUpdateTemplate(
        communikeyEvent,
        buildFlipToOpenTags(communikeyEvent.tags)
      );
      await publishCommunityUpdate(template, communitySigner);
      showToast(m.community_views_settings_flip_done(), 'success');
      typeOverlay = null;
    } catch (error) {
      console.error('settings: flip to open failed', error);
      showToast(
        m.community_views_settings_flip_failed({
          reason: error instanceof Error ? error.message : String(error)
        }),
        'error'
      );
    } finally {
      flipping = false;
    }
  }

  // Use the reusable community membership hook with reactive getter
  const getJoined = useCommunityMembership(() => communityId);

  // Get active user for authentication
  const getActiveUser = useActiveUser();
  const activeUser = $derived(getActiveUser());

  // Check if current user is the community owner
  let isOwner = $derived(isCommunityOwner(communikeyEvent?.pubkey));

  function handleEditCommunity() {
    modalStore.openModal('editCommunity', { communityEvent: communikeyEvent });
  }

  function handleDeleteCommunity() {
    modalStore.openModal('deleteCommunity', {
      communityEvent: communikeyEvent,
      profileEvent
    });
  }

  let isLeaving = $state(false);

  async function handleLeaveClick() {
    if (!activeUser) {
      showToast(m.toast_login_to_leave(), 'error');
      return;
    }

    if (isLeaving) return;

    isLeaving = true;
    try {
      const result = await leaveCommunity(communityId);
      if (result.success) {
        showToast(m.toast_community_unfollowed(), 'success');
        // Redirect to discover page after leaving
        await goto(/** @type {string} */ (resolve('/discover')));
      } else {
        showToast(result.error || m.toast_community_leave_failed(), 'error');
      }
    } catch (error) {
      console.error('Error leaving community:', error);
      showToast(m.toast_generic_error(), 'error');
    } finally {
      isLeaving = false;
    }
  }
</script>

<div>
  <div class="p-6">
    <div class="container mx-auto max-w-4xl">
      <div class="mb-6 flex items-center gap-3">
        <SettingsIcon class_="w-6 h-6 text-primary" />
        <h1 class="text-2xl font-bold">{m.community_views_settings_title()}</h1>
      </div>

      {#if communikeyEvent}
        <!-- Community Description -->
        {#if communikeyEvent?.content}
          <div class="card mb-6 bg-base-100 shadow-xl">
            <div class="card-body">
              <h2 class="mb-2 card-title">{m.community_views_settings_info_title()}</h2>
              <p class="text-base-content/80">{communikeyEvent.content}</p>
            </div>
          </div>
        {/if}

        <!-- Community-Typ (open <-> moderated flips) — owner-only, shown
             independently of Concord's feature flag; closed communities get
             a static hint instead of actions. -->
        {#if isOwner}
          <div class="card mb-6 bg-base-100 shadow-xl" data-testid="settings-type-card">
            <div class="card-body">
              <h2 class="card-title">{m.community_views_settings_type_title()}</h2>
              <p class="text-xs text-base-content/60">
                {m.community_views_settings_type_current()}
              </p>
              <p class="font-semibold">
                {#if communityType === 'open'}
                  {m.community_type_open_title()}
                {:else if communityType === 'moderated'}
                  {m.community_type_moderated_title()}
                {:else}
                  {m.community_type_closed_title()}
                {/if}
              </p>
              <p class="text-sm text-base-content/70">
                {#if communityType === 'open'}
                  {m.community_type_open_body()}
                {:else if communityType === 'moderated'}
                  {m.community_type_moderated_body()}
                {:else}
                  {m.community_type_closed_body()}
                {/if}
              </p>

              {#if communityType === 'open'}
                {#if moderatedCreationAvailable()}
                  <div class="mt-3">
                    <button
                      class="btn btn-neutral"
                      data-testid="settings-flip-to-moderated"
                      disabled={!activeUser || flipping}
                      onclick={openFlipToModerated}
                    >
                      {m.community_views_settings_flip_to_moderated()}
                    </button>
                    {#if !activeUser}
                      <p class="mt-1 text-xs text-warning">
                        {m.community_views_settings_flip_needs_account()}
                      </p>
                    {/if}
                  </div>
                {/if}
              {:else if communityType === 'moderated'}
                <div class="mt-3">
                  <button
                    class="btn btn-outline"
                    data-testid="settings-flip-to-open"
                    disabled={flipping}
                    onclick={openFlipToOpen}
                  >
                    {m.community_views_settings_flip_to_open()}
                  </button>
                </div>
              {:else}
                <p class="mt-3 text-xs text-base-content/60">{m.community_type_closed_hint()}</p>
              {/if}
            </div>
          </div>
        {/if}

        <!-- Mitglieder & Rollen (Task 8) — moderated-only, mounted for any
             signed-in user (not owner-gated): 39001 admins reach roster
             management + the approvals queue via personal-key NIP-29 ops
             with no community key needed, and the pane itself decides what
             (if anything) to render from its own roster — see there. Reports
             its role union upward so the Inhalte & Rechte editor below can
             suggest the community's actual admin roles. -->
        {#if communityType === 'moderated' && activeUser}
          <MembershipPane
            {communityId}
            {communikeyEvent}
            {profileEvent}
            onRolesChanged={(roles) => (roleSuggestions = roles)}
          />
        {/if}

        <!-- Inhalte & Rechte (Task 7) — owner-only, moderated-only per-section
             access tier editor. roleSuggestions comes from MembershipPane's
             roster above (admins' roles + 'admin', deduped). -->
        {#if isOwner && communityType === 'moderated'}
          <AccessTierEditor {communikeyEvent} {communitySigner} {roleSuggestions} />
        {/if}

        <!-- Private area (Concord) — owner-only create/attach/detach home -->
        {#if isOwner && concordArea.enabled}
          <div class="card mb-6 bg-base-100 shadow-xl" data-testid="concord-settings-card">
            <div class="card-body">
              <h2 class="card-title">
                🔒 {m.concord_settings_title()}
                <span class="badge badge-xs font-bold uppercase badge-accent">Beta</span>
              </h2>
              <p class="mb-2 text-xs text-base-content/60">{m.concord_settings_subtitle()}</p>

              {#if concordArea.pointer}
                <div class="flex items-center gap-3 rounded-xl border border-base-300 p-3">
                  <ConcordAreaBadge
                    name={linkedAreaName}
                    communityId={concordArea.pointer.communityId}
                    iconPointer={concordArea.community?.metadata?.icon}
                    class="h-10 w-10"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-semibold">{linkedAreaName}</p>
                    <p class="text-xs text-base-content/60">
                      {m.concord_attach_owner_sub()}
                    </p>
                  </div>
                  <button class="btn btn-sm btn-primary" onclick={() => goto('?view=channels')}>
                    {m.concord_settings_open_channels()}
                  </button>
                </div>
                <p class="mt-2 rounded-lg bg-primary/10 p-2.5 text-xs text-primary">
                  ✓ {m.concord_settings_linked_ok()}
                </p>
                <button
                  class="btn mt-1 self-start text-base-content/60 btn-ghost btn-sm hover:text-error"
                  data-testid="concord-settings-detach"
                  onclick={() => (concordOverlay = 'detach')}
                >
                  {m.concord_settings_detach()}
                </button>
              {:else}
                <p class="text-sm text-base-content/70">{m.concord_settings_lead()}</p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <button
                    class="btn btn-neutral"
                    data-testid="concord-settings-create"
                    onclick={() => (concordOverlay = 'create')}
                  >
                    🔒 {m.concord_settings_create()}
                  </button>
                  <button
                    class="btn btn-outline"
                    data-testid="concord-settings-attach"
                    onclick={() => (concordOverlay = 'attach')}
                  >
                    🔗 {m.concord_attach_secondary()}
                  </button>
                </div>
                <p class="mt-3 rounded-lg bg-base-200 p-2.5 text-xs text-base-content/60">
                  🙈 {m.concord_settings_invisible_hint()}
                </p>
              {/if}
            </div>
          </div>
        {/if}

        <!-- Admin Settings -->
        {#if isOwner}
          <div class="card bg-base-100 shadow-xl">
            <div class="card-body">
              <h2 class="mb-4 card-title">
                {m.community_views_settings_admin_title()}
              </h2>
              <p class="mb-4 text-sm text-base-content/70">
                {m.community_views_settings_admin_description()}
              </p>

              <div class="space-y-3">
                <button onclick={handleEditCommunity} class="btn w-full btn-primary">
                  {m.community_views_settings_edit_button()}
                </button>
                <p class="text-center text-xs text-base-content/60">
                  {m.community_views_settings_edit_help()}
                </p>
              </div>
            </div>
          </div>

          <!-- Form Link Manager -->
          <div class="mt-6">
            <FormLinkManager communityEvent={communikeyEvent} communityPubkey={communityId} />
          </div>

          <!-- Danger Zone -->
          <div class="card mt-6 border border-error/40 bg-base-100 shadow-xl">
            <div class="card-body">
              <h2 class="mb-2 card-title text-error">
                {m.community_views_settings_danger_title()}
              </h2>
              <p class="mb-4 text-sm text-base-content/70">
                {m.community_views_settings_danger_description()}
              </p>
              <button onclick={handleDeleteCommunity} class="btn w-full btn-outline btn-error">
                {m.community_views_settings_delete_button()}
              </button>
            </div>
          </div>
        {/if}

        <!-- Community Actions -->
        <div class="card mt-6 bg-base-100 shadow-xl">
          <div class="card-body">
            <h2 class="mb-4 card-title">{m.community_views_settings_actions_title()}</h2>

            <div class="space-y-3">
              <button
                onclick={handleLeaveClick}
                disabled={isLeaving || !getJoined()}
                class="btn w-full btn-outline btn-error"
              >
                {#if isLeaving}
                  <span class="loading loading-xs loading-spinner"></span>
                  {m.community_views_settings_leaving()}
                {:else}
                  {m.community_views_settings_leave_button()}
                {/if}
              </button>
              <p class="text-center text-xs text-base-content/60">
                {m.community_views_settings_leave_help()}
              </p>
            </div>
          </div>
        </div>
      {:else}
        <div class="flex items-center justify-center py-12">
          <div class="loading loading-lg loading-spinner text-primary"></div>
        </div>
      {/if}
    </div>
  </div>
</div>

{#if concordOverlay === 'attach'}
  <AreaAttachModal {communikeyEvent} onClose={() => (concordOverlay = null)} />
{:else if concordOverlay === 'create'}
  <ChannelCreateWizard
    {communikeyEvent}
    communityProfile={profileEvent}
    community={concordArea.community}
    onClose={() => (concordOverlay = null)}
    onCreated={() => {
      concordOverlay = null;
      goto('?view=channels');
    }}
  />
{:else if concordOverlay === 'detach'}
  <!-- Same confirm skeleton as PrivateChannelsView's dissolve dialog. -->
  <div class="modal-open modal" role="dialog">
    <div class="modal-box max-w-sm text-center">
      <h3 class="text-lg font-extrabold">{m.concord_settings_detach_title()}</h3>
      <p class="my-3 text-sm text-base-content/70">
        {m.concord_settings_detach_body({ name: linkedAreaName })}
      </p>
      <div class="modal-action justify-center">
        <button class="btn btn-ghost" onclick={() => (concordOverlay = null)}
          >{m.concord_cancel()}</button
        >
        <button
          class="btn btn-error"
          data-testid="concord-detach-confirm"
          disabled={detaching}
          onclick={handleDetach}>{m.concord_settings_detach_action()}</button
        >
      </div>
    </div>
  </div>
{/if}

{#if typeOverlay === 'flip-to-moderated'}
  <!-- Same confirm skeleton as the Concord detach dialog above. -->
  <div class="modal-open modal" role="dialog">
    <div class="modal-box max-w-sm text-center">
      <h3 class="text-lg font-extrabold">{m.community_views_settings_flip_to_moderated()}</h3>
      <p class="my-3 text-sm text-base-content/70">
        {m.community_views_settings_flip_to_moderated_confirm()}
      </p>
      <div class="modal-action justify-center">
        <button class="btn btn-ghost" disabled={flipping} onclick={closeTypeOverlay}
          >{m.concord_cancel()}</button
        >
        <button
          class="btn btn-primary"
          data-testid="settings-flip-confirm"
          disabled={flipping}
          onclick={handleFlipToModerated}
        >
          {#if flipping}<span class="loading loading-xs loading-spinner"></span>{/if}
          {m.community_views_settings_flip_to_moderated()}
        </button>
      </div>
    </div>
  </div>
{:else if typeOverlay === 'flip-to-open'}
  <div class="modal-open modal" role="dialog">
    <div class="modal-box max-w-sm text-center">
      <h3 class="text-lg font-extrabold">{m.community_views_settings_flip_to_open()}</h3>
      <p class="my-3 text-sm text-base-content/70">
        {m.community_views_settings_flip_to_open_confirm({ channels: channelNames.join(', ') })}
      </p>
      <div class="modal-action justify-center">
        <button class="btn btn-ghost" disabled={flipping} onclick={closeTypeOverlay}
          >{m.concord_cancel()}</button
        >
        <button
          class="btn btn-error"
          data-testid="settings-flip-confirm"
          disabled={flipping}
          onclick={handleFlipToOpen}
        >
          {#if flipping}<span class="loading loading-xs loading-spinner"></span>{/if}
          {m.community_views_settings_flip_to_open()}
        </button>
      </div>
    </div>
  </div>
{/if}
