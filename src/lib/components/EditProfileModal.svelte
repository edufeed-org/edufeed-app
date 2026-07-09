<script>
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte.js';
  import AvatarUploader from './shared/AvatarUploader.svelte';
  import BannerUploader from './shared/BannerUploader.svelte';
  import EducatorContextFields from './shared/EducatorContextFields.svelte';
  import MembershipCard from './membership/MembershipCard.svelte';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { actionRunner } from '$lib/stores/action-runner.svelte.js';
  import { UpdateProfile } from 'applesauce-actions/actions';
  import { ModifyListTags } from '$lib/actions/list-actions.js';
  import {
    parseEdufeedProfile,
    interestsFromListEvent
  } from '$lib/helpers/educational/educatorProfile.js';
  import { addressLoader } from '$lib/loaders/base.js';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { untrack } from 'svelte';
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
      about: '',
      picture: '',
      banner: '',
      website: ''
    })
  );

  /** @type {import('$lib/helpers/educational/educatorProfile.js').EdufeedProfile} */
  let edufeed = $state({ interests: [], educationalLevels: [], subjects: [], locations: [] });

  /**
   * The user's kind 10015 interests list. It is authoritative for interests;
   * the legacy kind-0 `edufeed.interests` (seeded by the init effect below)
   * only stays when no list exists.
   * @type {import('nostr-tools').NostrEvent | null}
   */
  let interestsListEvent = $state(null);
  // Once the user edits interests, stop syncing them from the incoming list.
  let interestsTouched = false;

  // Sync form data when profile becomes available (modal opens with profile data)
  let initializedForProfile = $state(/** @type {string | null} */ (null));
  $effect(() => {
    // Only initialize once per profile to avoid overwriting user edits
    if (pubkey && initializedForProfile !== pubkey && profile) {
      userData = {
        name: profile.name || '',
        about: profile.about || '',
        picture: profile.picture || '',
        banner: profile.banner || '',
        website: profile.website || ''
      };
      edufeed = parseEdufeedProfile(profile);
      // If the kind 10015 list already arrived, it wins over the legacy
      // kind-0 interests just parsed (profile can arrive after the list).
      untrack(() => {
        if (interestsListEvent) {
          edufeed = { ...edufeed, interests: interestsFromListEvent(interestsListEvent) };
        }
      });
      initializedForProfile = pubkey;
    }
  });

  $effect(() => {
    const targetPubkey = pubkey;
    const own = isOwn;
    if (!own || !targetPubkey) return;

    const loaderSub = addressLoader({
      kind: 10015,
      pubkey: targetPubkey,
      relays: untrack(() => getAllLookupRelays())
    }).subscribe();

    const modelSub = eventStore.replaceable(10015, targetPubkey).subscribe((event) => {
      // The first emission is synchronous — untrack so state reads inside the
      // callback don't become dependencies of this effect.
      untrack(() => {
        interestsListEvent = event || null;
        if (event && !interestsTouched) {
          edufeed = { ...edufeed, interests: interestsFromListEvent(event) };
        }
      });
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  /** @param {import('$lib/helpers/educational/educatorProfile.js').EdufeedProfile} value */
  function handleContextChange(value) {
    if (
      value.interests.length !== edufeed.interests.length ||
      value.interests.some((v, i) => v !== edufeed.interests[i])
    ) {
      interestsTouched = true;
    }
    edufeed = value;
  }

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
      if (isOwn) {
        // UpdateProfile shallow-merges into the existing kind 0, preserving
        // nip05/lud16/display_name and any third-party keys. Cleared fields
        // are submitted as "" (merge overwrites, never deletes). The edufeed
        // object is replaced wholesale — always the full object, minus
        // interests, which live in the kind 10015 list (so legacy
        // edufeed.interests are dropped from the kind 0 on save).
        await actionRunner.run(UpdateProfile, {
          name: userData.name,
          about: userData.about,
          picture: userData.picture,
          banner: userData.banner,
          website: userData.website,
          edufeed: {
            educationalLevels: edufeed.educationalLevels,
            subjects: edufeed.subjects,
            locations: edufeed.locations
          }
        });

        // Diff interests against the current kind 10015 list (empty when none
        // exists yet, so legacy kind-0 interests migrate in full as adds).
        const baseline = interestsFromListEvent(interestsListEvent);
        const add = edufeed.interests.filter((i) => !baseline.includes(i)).map((i) => ['t', i]);
        const remove = baseline.filter((i) => !edufeed.interests.includes(i)).map((i) => ['t', i]);
        if (add.length || remove.length) {
          await actionRunner.run(ModifyListTags, { kind: 10015, add, remove });
        }
      } else {
        // Community profile: sign with the caller-supplied community signer.
        // Merge over the existing profile so unknown keys survive.
        const profileContent = {
          ...profile,
          name: userData.name,
          about: userData.about,
          picture: userData.picture,
          banner: userData.banner,
          website: userData.website
        };

        const event = {
          kind: 0,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: JSON.stringify(profileContent),
          pubkey
        };

        const signedEvent = await signer.signEvent(event);
        const result = await publishEvent(signedEvent);
        if (!result.success) {
          throw new Error('Failed to publish profile update to any relay');
        }
        // Add to EventStore for immediate UI updates
        eventStore.add(signedEvent);
      }

      console.log('Profile updated successfully');
      submitSuccess = true;

      // Close modal after a brief delay to show success message
      setTimeout(() => {
        modalStore.closeModal();
      }, 1000);
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

    <!-- Sectioned Profile Form -->
    <div class="space-y-8">
      <!-- Section: Wer bist du -->
      <section class="space-y-4">
        <h4 class="text-lg font-semibold">{m.profile_edit_section_who()}</h4>

        <div class="flex flex-col items-center">
          <AvatarUploader bind:userData {signer} bind:errors />
        </div>

        <div class="flex w-full flex-col items-center">
          <div class="w-full max-w-md">
            <BannerUploader bind:userData {signer} bind:errors />
          </div>
        </div>

        <div class="form-control flex flex-col">
          <label class="label" for="profile-name">
            <span class="label-text">{m.profile_form_name_label()}</span>
          </label>
          <input
            id="profile-name"
            type="text"
            bind:value={userData.name}
            placeholder={m.profile_form_name_placeholder()}
            class="input-bordered input w-full"
            class:input-error={errors.name}
          />
          {#if errors.name}
            <div class="label" aria-live="polite">
              <span class="label-text-alt text-error">{errors.name}</span>
            </div>
          {/if}
        </div>
      </section>

      <!-- Section: Beschreibung -->
      <section class="space-y-2">
        <h4 class="text-lg font-semibold">{m.profile_edit_section_about()}</h4>
        <textarea
          id="profile-about"
          bind:value={userData.about}
          placeholder={m.profile_form_about_placeholder()}
          class="textarea-bordered textarea h-24 w-full"
        ></textarea>
      </section>

      {#if isOwn}
        <!-- Section: Pädagogischer Kontext -->
        <section class="space-y-2">
          <h4 class="text-lg font-semibold">{m.profile_edit_section_context()}</h4>
          <EducatorContextFields value={edufeed} compact onchange={handleContextChange} />
        </section>
      {/if}

      <!-- Section: Website -->
      <section class="space-y-2">
        <h4 class="text-lg font-semibold">{m.profile_edit_section_website()}</h4>
        <input
          id="profile-website"
          type="url"
          bind:value={userData.website}
          placeholder={m.profile_form_website_placeholder()}
          class="input-bordered input w-full"
          class:input-error={errors.website}
        />
        {#if errors.website}
          <div class="label" aria-live="polite">
            <span class="label-text-alt text-error">{errors.website}</span>
          </div>
        {/if}
      </section>

      {#if isOwn}
        <!-- Section: edufeed-Handle (status card + application form; renders
             only when membership is enabled in runtime config) -->
        <section class="space-y-2">
          <MembershipCard />
        </section>
      {/if}
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
