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
  import * as m from '$lib/paraglide/messages';

  let { communityId, communikeyEvent, profileEvent } = $props();

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
