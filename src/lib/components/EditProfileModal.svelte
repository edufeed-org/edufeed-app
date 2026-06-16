<script>
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte.js';
  import ProfileForm from './shared/ProfileForm.svelte';
  import AvatarUploader from './shared/AvatarUploader.svelte';
  import BannerUploader from './shared/BannerUploader.svelte';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import * as m from '$lib/paraglide/messages';

  let { modalId = 'edit-profile-modal' } = $props();

  // Get profile data from modal props
  const modalProps = $derived(/** @type {any} */ (modalStore.modalProps));
  const profile = $derived(modalProps.profile || {});
  const pubkey = $derived(modalProps.pubkey);
  // Optional signer override — used when editing a community profile (the
  // active user holds the community's signer in addition to their own). When
  // absent, falls back to the active user's signer (standard personal edit).
  const signer = $derived(modalProps.signer ?? manager.active?.signer ?? null);
  // True when the editor is editing their own profile.
  const isOwn = $derived(pubkey === manager.active?.pubkey);

  // Initialize form data with current profile values
  let userData = $state(
    /** @type {any} */ ({
      name: '',
      display_name: '',
      about: '',
      picture: '',
      banner: '',
      website: '',
      nip05: '',
      lud16: ''
    })
  );

  // Sync form data when profile becomes available (modal opens with profile data)
  let initializedForProfile = $state(/** @type {string | null} */ (null));
  $effect(() => {
    // Only initialize once per profile to avoid overwriting user edits
    if (pubkey && initializedForProfile !== pubkey && profile) {
      userData = {
        name: profile.name || '',
        display_name: profile.display_name || '',
        about: profile.about || '',
        picture: profile.picture || '',
        banner: profile.banner || '',
        website: profile.website || '',
        nip05: profile.nip05 || '',
        lud16: profile.lud16 || ''
      };
      initializedForProfile = pubkey;
    }
  });

  let errors = $state(/** @type {any} */ ({}));
  let isSubmitting = $state(false);
  let submitError = $state('');
  let submitSuccess = $state(false);

  /**
   * Sync modal close with store state
   * This effect ensures that when the dialog closes (via ESC, backdrop, etc.),
   * the modal store state is updated accordingly
   */
  $effect(() => {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (!dialog) return;

    const handleDialogClose = () => {
      // Only update store if this modal is currently active
      if (modalStore.activeModal === 'profile') {
        console.log('EditProfileModal: Dialog closed, syncing with store');
        modalStore.closeModal();
      }
    };

    dialog.addEventListener('close', handleDialogClose);
    return () => {
      dialog.removeEventListener('close', handleDialogClose);
    };
  });

  /**
   * Validate form data
   */
  function validate() {
    errors = {};

    if (!userData.name?.trim()) {
      errors.name = m.profile_edit_modal_error_name_required();
      return false;
    }

    // Validate URLs if provided
    if (userData.website && userData.website.trim()) {
      try {
        new URL(userData.website);
      } catch {
        errors.website = m.profile_edit_modal_error_invalid_url();
        return false;
      }
    }

    if (userData.picture && userData.picture.trim()) {
      try {
        new URL(userData.picture);
      } catch {
        errors.picture = m.profile_edit_modal_error_invalid_image_url();
        return false;
      }
    }

    if (userData.banner && userData.banner.trim()) {
      try {
        new URL(userData.banner);
      } catch {
        errors.banner = m.profile_edit_modal_error_invalid_image_url();
        return false;
      }
    }

    return true;
  }

  /**
   * Handle form submission
   */
  async function handleSubmit() {
    submitError = '';
    submitSuccess = false;

    // Validate form
    if (!validate()) {
      return;
    }

    // Check we have a signer for the target pubkey (own profile → active
    // user's signer; community → caller-supplied community signer).
    if (!signer || !pubkey) {
      submitError = m.profile_edit_modal_error_must_login();
      return;
    }

    // Verify the signer can actually sign for the target entity. Resolve the
    // pubkey via getPublicKey() — applesauce signers (PrivateKeySigner,
    // PasswordSigner, and ExtensionSigner before its first call) don't expose
    // a synchronous `.pubkey`, so comparing `signer.pubkey` wrongly blocks edits.
    let signerPubkey;
    try {
      signerPubkey = await signer.getPublicKey();
    } catch {
      submitError = m.profile_edit_modal_error_ownership();
      return;
    }
    if (signerPubkey !== pubkey) {
      submitError = m.profile_edit_modal_error_ownership();
      return;
    }

    isSubmitting = true;

    try {
      // Create profile content object (only include non-empty fields)
      const profileContent = {};
      if (userData.name) profileContent.name = userData.name;
      if (userData.display_name) profileContent.display_name = userData.display_name;
      if (userData.about) profileContent.about = userData.about;
      if (userData.picture) profileContent.picture = userData.picture;
      if (userData.banner) profileContent.banner = userData.banner;
      if (userData.website) profileContent.website = userData.website;
      if (userData.nip05) profileContent.nip05 = userData.nip05;
      if (userData.lud16) profileContent.lud16 = userData.lud16;

      // Create Kind 0 event (profile metadata)
      const event = {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify(profileContent),
        pubkey
      };

      // Sign the event with the appropriate signer (own or community).
      const signedEvent = await signer.signEvent(event);

      // Publish using outbox model
      const result = await publishEvent(signedEvent);

      if (result.success) {
        // Add to EventStore for immediate UI updates
        eventStore.add(signedEvent);
        console.log('Profile updated successfully');
        submitSuccess = true;

        // Close modal after a brief delay to show success message
        setTimeout(() => {
          modalStore.closeModal();
        }, 1000);
      } else {
        throw new Error('Failed to publish profile update to any relay');
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      submitError = error instanceof Error ? error.message : m.profile_edit_modal_error_failed();
    } finally {
      isSubmitting = false;
    }
  }

  /**
   * Handle modal close
   */
  function handleClose() {
    if (!isSubmitting) {
      modalStore.closeModal();
    }
  }
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box max-w-2xl">
    <!-- Modal Header -->
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h3 class="text-2xl font-bold">
          {isOwn ? m.profile_edit_modal_title() : m.profile_edit_modal_title_community()}
        </h3>
        {#if !isOwn}
          <p class="text-xs text-base-content/60">{m.profile_edit_modal_kind0_note()}</p>
        {/if}
      </div>
      <button onclick={handleClose} class="btn btn-circle btn-ghost btn-sm" disabled={isSubmitting}>
        ✕
      </button>
    </div>

    <!-- Success Message -->
    {#if submitSuccess}
      <div class="mb-4 alert alert-success">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-6 w-6 shrink-0 stroke-current"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span>{m.profile_edit_modal_success()}</span>
      </div>
    {/if}

    <!-- Error Message -->
    {#if submitError}
      <div class="mb-4 alert alert-error">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-6 w-6 shrink-0 stroke-current"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span>{submitError}</span>
      </div>
    {/if}

    <!-- Profile Form -->
    <div class="space-y-6">
      <!-- Avatar Uploader (centered) -->
      <div class="flex flex-col items-center">
        <AvatarUploader bind:userData {signer} bind:errors />
      </div>

      <!-- Banner Uploader (centered with max-width) -->
      <div class="flex w-full flex-col items-center">
        <div class="w-full max-w-md">
          <BannerUploader bind:userData {signer} bind:errors />
        </div>
      </div>

      <!-- Form Fields (centered with max-width) -->
      <div class="flex w-full flex-col items-center">
        <div class="w-full max-w-md space-y-4">
          <ProfileForm bind:userData bind:errors hideBanner />
        </div>
      </div>
    </div>

    <!-- Modal Actions -->
    <div class="modal-action">
      <button onclick={handleClose} class="btn btn-ghost" disabled={isSubmitting}>
        {m.profile_edit_modal_cancel_button()}
      </button>
      <button onclick={handleSubmit} class="btn btn-primary" disabled={isSubmitting}>
        {#if isSubmitting}
          <span class="loading loading-sm loading-spinner"></span>
          {m.profile_edit_modal_saving()}
        {:else}
          {m.profile_edit_modal_save_button()}
        {/if}
      </button>
    </div>
  </div>

  <!-- Modal backdrop -->
  <form method="dialog" class="modal-backdrop">
    <button onclick={handleClose} disabled={isSubmitting}>close</button>
  </form>
</dialog>
