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
  import { manager } from '$lib/stores/accounts.svelte';
  import ConcordAreaBadge from '$lib/components/shared/ConcordAreaBadge.svelte';
  import AreaAttachModal from '$lib/components/community/channels/AreaAttachModal.svelte';
  import ChannelCreateWizard from '$lib/components/community/channels/ChannelCreateWizard.svelte';
  import * as m from '$lib/paraglide/messages';

  let { communityId, communikeyEvent, profileEvent } = $props();

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
  const concordCommunitySigner = $derived.by(() => {
    const pk = communikeyEvent?.pubkey;
    if (!pk) return null;
    return manager.getAccountForPubkey(pk)?.signer ?? null;
  });

  async function handleDetach() {
    if (detaching) return;
    detaching = true;
    try {
      await detachConcordArea({ communikeyEvent, communitySigner: concordCommunitySigner });
      showToast(m.concord_settings_detached_toast(), 'success');
      concordOverlay = null;
    } catch (error) {
      console.error('concord: detach failed', error);
      showToast(m.concord_settings_detach_failed(), 'error');
    } finally {
      detaching = false;
    }
  }

  // Use the reusable community membership hook with reactive getter
  const getJoined = useCommunityMembership(() => communityId);

  // Get active user for authentication
  const getActiveUser = useActiveUser();
  const activeUser = $derived(getActiveUser());

  // Check if current user is the community owner
  let isOwner = $derived(
    communikeyEvent?.pubkey && activeUser?.pubkey && communikeyEvent.pubkey === activeUser.pubkey
  );

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

      {#if profileEvent && communikeyEvent}
        <!-- Community Description -->
        {#if communikeyEvent?.content}
          <div class="card mb-6 bg-base-100 shadow-xl">
            <div class="card-body">
              <h2 class="mb-2 card-title">{m.community_views_settings_info_title()}</h2>
              <p class="text-base-content/80">{communikeyEvent.content}</p>
            </div>
          </div>
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
