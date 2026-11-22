<!--
  SuggestedCommunitiesModal - the signup wizard's community step on its own,
  opened from Termi's setup message for an account that belongs to no
  community (e.g. after it lost its setup). The deployment's suggested
  communities are pre-selected like in signup; joining is one kind 30000
  update through joinCommunities.

  Rendered only while active (ModalManager mounts/unmounts it), same pattern
  as Nip05ActivatedModal.
-->

<script>
  import { SvelteSet } from 'svelte/reactivity';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { joinCommunities } from '$lib/helpers/community.js';
  import { communikeyTimelineLoader } from '$lib/loaders/community.js';
  import { normalizePubkey } from '$lib/helpers/pubkey.js';
  import { showToast } from '$lib/helpers/toast';
  import SignupCommunityPicker from './SignupCommunityPicker.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ modalId?: string }} */
  let { modalId = 'suggested-communities-modal' } = $props();

  let selected = $state.raw(
    new SvelteSet(
      /** @type {string[]} */ (
        (runtimeConfig.signup?.suggestedCommunities || []).map(normalizePubkey).filter(Boolean)
      )
    )
  );
  let joining = $state(false);

  // The picker reads kind 10222 from the store; load them like the signup step does.
  $effect(() => {
    const sub = communikeyTimelineLoader().subscribe();
    return () => sub.unsubscribe();
  });

  async function handleJoin() {
    joining = true;
    const result = await joinCommunities(Array.from(selected));
    joining = false;
    if (result.success) modalStore.closeModal();
    else showToast(result.error || m.suggested_communities_modal_failed(), 'error');
  }
</script>

<dialog open class="modal-open modal" id={modalId} data-testid="suggested-communities-modal">
  <div class="modal-box max-w-lg">
    <h3 class="mb-1 text-lg font-bold">{m.suggested_communities_modal_title()}</h3>
    <p class="mb-4 text-sm text-base-content/70">{m.suggested_communities_modal_lead()}</p>

    <SignupCommunityPicker bind:selected />

    <div class="modal-action">
      <button class="btn btn-ghost" onclick={() => modalStore.closeModal()} disabled={joining}>
        {m.suggested_communities_modal_skip()}
      </button>
      <button
        class="btn btn-primary"
        data-testid="suggested-communities-join"
        disabled={joining || selected.size === 0}
        onclick={handleJoin}
      >
        {#if joining}<span class="loading loading-sm loading-spinner"></span>{/if}
        {m.suggested_communities_modal_join()}
      </button>
    </div>
  </div>
</dialog>
