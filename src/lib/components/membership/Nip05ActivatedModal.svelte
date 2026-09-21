<!--
  Nip05ActivatedModal - "your address is active" confirmation.

  Opened via modalStore.openModal('nip05Activated', { address }) right after
  the granted membership handle landed on the profile — from the Termi hint,
  the bell/inbox row (both through activateGrantedHandle) and the settings
  MembershipCard. Before this modal the activation ended silently: the badge
  appeared and nothing told the user what the address is good for or what
  to do next (issue: NIP-05 grant only visible in Termi).

  Rendered only while active (ModalManager mounts/unmounts it), so no
  <dialog>.showModal() plumbing is needed — same pattern as MembershipApplyModal.
-->

<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { profileLink } from '$lib/helpers/nostrUtils.js';
  import { CheckIcon, CloseIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ modalId?: string, address?: string }} */
  let { modalId = 'nip05-activated-modal', address = '' } = $props();

  const getActiveUser = useActiveUser();
  const domain = $derived(address.split('@')[1] || '');

  function handleClose() {
    modalStore.closeModal();
  }

  /** The concrete next step: see the profile the way others see it now. */
  function handleViewProfile() {
    const user = getActiveUser();
    modalStore.closeModal();
    if (user) goto(resolve(/** @type {any} */ (profileLink(user.pubkey))));
  }
</script>

<dialog open class="modal-open modal" id={modalId} data-testid="nip05-activated-modal">
  <div class="modal-box max-w-md">
    <div class="mb-2 flex items-start justify-between gap-4">
      <h3 class="text-lg font-bold">{m.nip05_activated_title()}</h3>
      <button
        class="btn btn-circle btn-ghost btn-sm"
        data-testid="nip05-activated-close"
        onclick={handleClose}
        aria-label={m.common_close()}
      >
        <CloseIcon class_="w-5 h-5" />
      </button>
    </div>

    <p class="mb-3 text-sm" data-testid="nip05-activated-lead">
      {m.nip05_activated_lead({ address })}
    </p>

    <ul class="mb-4 space-y-2 text-sm text-base-content/80">
      <li class="flex items-start gap-2">
        <CheckIcon class_="mt-0.5 h-4 w-4 flex-shrink-0 text-success" />
        <span>{m.nip05_activated_point_verified()}</span>
      </li>
      <li class="flex items-start gap-2">
        <CheckIcon class_="mt-0.5 h-4 w-4 flex-shrink-0 text-success" />
        <span>{m.nip05_activated_point_findable()}</span>
      </li>
      <li class="flex items-start gap-2">
        <CheckIcon class_="mt-0.5 h-4 w-4 flex-shrink-0 text-success" />
        <span>{m.nip05_activated_point_trust({ domain })}</span>
      </li>
    </ul>

    <p class="text-sm font-medium">{m.nip05_activated_next_step()}</p>

    <div class="modal-action">
      <button class="btn btn-ghost" onclick={handleClose}>{m.common_close()}</button>
      <button
        class="btn btn-primary"
        data-testid="nip05-activated-view-profile"
        onclick={handleViewProfile}
      >
        {m.nip05_activated_cta_profile()}
      </button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button onclick={handleClose}>{m.common_close()}</button>
  </form>
</dialog>
