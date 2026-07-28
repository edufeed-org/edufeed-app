<!--
  MembershipApplyModal - the @edufeed.org handle application form in a dialog.
  Opened via modalStore.openModal('membershipApply') from the Termi assistant's
  nip05 hint and from the settings MembershipCard, so both entry points land
  straight on the form instead of routing through the settings page.

  Rendered only while active (ModalManager mounts/unmounts it), so no
  <dialog>.showModal() plumbing is needed — same pattern as InviteToEventModal.

  On submit the form has already mirrored the published event into the
  eventStore, so closing here lets the surface behind the modal (Termi hint /
  settings card) flip to "waiting for review" in place.
-->

<script>
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { CloseIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';
  import MembershipApplicationForm from './MembershipApplicationForm.svelte';

  let { modalId = 'membership-apply-modal' } = $props();

  function handleClose() {
    modalStore.closeModal();
  }
</script>

<!-- `open` (rather than showModal()) keeps the dialog visible to assistive tech
     and to role-based queries; daisyUI's .modal handles the overlay styling. -->
<dialog open class="modal-open modal" id={modalId}>
  <div class="modal-box max-w-2xl">
    <div class="mb-2 flex items-start justify-between gap-4">
      <h3 class="text-lg font-bold">{m.auth_signup_modal_membership_title()}</h3>
      <button
        class="btn btn-circle btn-ghost btn-sm"
        data-testid="membership-apply-close"
        onclick={handleClose}
        aria-label={m.common_close()}
      >
        <CloseIcon class_="w-5 h-5" />
      </button>
    </div>
    <p class="mb-4 text-sm text-base-content/70">{m.auth_signup_modal_membership_help()}</p>

    <MembershipApplicationForm onsubmitted={handleClose} />
  </div>
  <form method="dialog" class="modal-backdrop">
    <button onclick={handleClose}>{m.common_close()}</button>
  </form>
</dialog>
