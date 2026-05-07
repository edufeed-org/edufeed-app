<script>
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import { SimpleAccount } from 'applesauce-accounts/accounts';
  import { generateSignupKeypair } from '$lib/helpers/signupKeypair.js';
  import { buildCommunityFollowSet } from '$lib/helpers/communityFollowSet.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import ChevronRightIcon from './icons/ui/ChevronRightIcon.svelte';
  import AvatarUploader from './shared/AvatarUploader.svelte';

  let { modalId } = $props();

  // 2-step wizard:
  //   Step 1 = name → creates SimpleAccount and activates it (user is logged in)
  //   Step 2 = optional profile polish → publishes kind 0
  // Backup file + suggested follows are deferred to post-login banners.
  let currentStep = $state(1);

  let userData = $state({
    name: '',
    about: '',
    picture: '',
    publicKey: '',
    nsec: '',
    npub: ''
  });

  // Raw refs — must NOT be deeply proxied. Svelte 5's $state() wraps nested
  // objects in Proxies, which breaks `instanceof Uint8Array` checks inside
  // @noble/secp256k1 signing (see CLAUDE.md "$state.raw() for Event Arrays
  // with Symbol Data"). Same hazard applies to signer instances whose .key
  // field is a Uint8Array.
  let privateKey = $state.raw(/** @type {Uint8Array | null} */ (null));
  // SimpleSigner is a deprecated re-export alias; its type resolves to the
  // class constructor rather than instance, so we keep this loosely typed and
  // cast at usage sites where a stricter type matters.
  let _signer = $state.raw(/** @type {any} */ (null));

  let isPublishing = $state(false);
  let errors = $state(/** @type {Record<string, string>} */ ({}));

  /**
   * Sync modal close with store state. Reset state on close so a re-opened
   * modal starts fresh.
   */
  $effect(() => {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (!dialog) return;

    const handleDialogClose = () => {
      // Don't allow closing mid-publish; reopen if attempted.
      if (isPublishing) {
        dialog.showModal();
        return;
      }
      if (modalStore.activeModal === 'signup') {
        modalStore.closeModal();
        resetState();
      }
    };

    dialog.addEventListener('close', handleDialogClose);
    return () => dialog.removeEventListener('close', handleDialogClose);
  });

  // Generate keypair on mount so Step 2's AvatarUploader has a working signer
  // immediately. Re-runs after resetState() clears privateKey on modal reopen.
  $effect(() => {
    if (!privateKey) {
      try {
        const generated = generateSignupKeypair();
        privateKey = generated.privateKey;
        userData.publicKey = generated.publicKey;
        userData.nsec = generated.nsec;
        userData.npub = generated.npub;
        _signer = /** @type {any} */ (generated.signer);
      } catch (error) {
        console.error('Error generating keypair:', error);
        errors.keyGeneration = 'Failed to generate keys. Please try again.';
      }
    }
  });

  function resetState() {
    currentStep = 1;
    userData = {
      name: '',
      about: '',
      picture: '',
      publicKey: '',
      nsec: '',
      npub: ''
    };
    errors = {};
    privateKey = null;
    _signer = null;
  }

  /**
   * Step 1 → Step 2: validate name, create the SimpleAccount, activate it.
   * The user is now logged in; closing the modal at Step 2 is a valid exit.
   */
  function continueFromStep1() {
    errors = {};
    if (!userData.name.trim()) {
      errors.name = 'Name is required';
      return;
    }
    if (!privateKey || !userData.publicKey || !_signer) {
      errors.keyGeneration = 'Keys not ready. Please wait a moment and try again.';
      return;
    }

    // Idempotent: if somehow this fires twice, don't double-add the account.
    if (!manager.getAccountForPubkey(userData.publicKey)) {
      const account = new SimpleAccount(userData.publicKey, _signer);
      manager.addAccount(account);
      manager.setActive(account);
    }

    // Marks this pubkey as a wizard graduate. Backup + suggested-follows
    // banners only appear for users with this flag, so existing accounts
    // (extension, paste-in nsec, returning sessions) aren't bothered.
    try {
      localStorage.setItem(`signed-up-here:${userData.publicKey}`, '1');
    } catch {
      /* localStorage may be unavailable in some embeds; banners simply won't show */
    }

    currentStep = 2;
  }

  /**
   * Step 2 "Done": build + sign kind 0 with whatever fields are filled, apply
   * optimistically to EventStore, fire-and-forget publish. Mirrors the prior
   * SignupModal pattern so we avoid inventing a new path.
   */
  async function finishProfile() {
    if (!_signer || !userData.publicKey) {
      errors.publishing = 'Account not ready.';
      return;
    }

    try {
      isPublishing = true;

      const profileContent = /** @type {Record<string, string>} */ ({});
      if (userData.name) profileContent.name = userData.name;
      if (userData.about) profileContent.about = userData.about;
      if (userData.picture) profileContent.picture = userData.picture;

      const metadataEvent = {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify(profileContent),
        pubkey: userData.publicKey
      };
      const signedMetadataEvent = await _signer.signEvent(metadataEvent);

      // Community follow set: identifiers come from deployment config today;
      // Task 5 swaps in the user's step-3 picker selection.
      const { signed: signedCommunitiesEvent, targetPubkeys: communityPubkeys } =
        await buildCommunityFollowSet(
          /** @type {any} */ (_signer),
          userData.publicKey,
          runtimeConfig.signup?.autoJoinCommunities
        );

      // Optimistic local apply.
      eventStore.add(signedMetadataEvent);
      if (signedCommunitiesEvent) eventStore.add(signedCommunitiesEvent);

      isPublishing = false;
      closeModal();

      // Background publish.
      publishEvent(signedMetadataEvent).catch((err) =>
        console.warn('Background publish of profile metadata failed:', err)
      );
      if (signedCommunitiesEvent) {
        publishEvent(signedCommunitiesEvent, communityPubkeys).catch((err) =>
          console.warn('Background publish of community follow set failed:', err)
        );
      }
    } catch (error) {
      console.error('Error publishing profile:', error);
      errors.publishing = 'Failed to save profile. Please try again.';
      isPublishing = false;
    }
  }

  function closeModal() {
    if (isPublishing) return;
    modalStore.closeModal();
    resetState();
  }
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box max-w-xl">
    <div class="mb-6">
      <h1 class="mb-4 text-2xl font-bold">{m.auth_signup_modal_title()}</h1>

      <ul class="steps w-full">
        <li class="step {currentStep >= 1 ? 'step-primary' : ''}">
          {m.auth_signup_modal_step1_account()}
        </li>
        <li class="step {currentStep >= 2 ? 'step-primary' : ''}">
          {m.auth_signup_modal_step2_profile()}
        </li>
      </ul>
    </div>

    <div class="min-h-72">
      {#if currentStep === 1}
        <!-- Wrapping Step 1 in a <form> so pressing Enter in the name input
             advances to Step 2 (HTML implicit form submission). The actions
             below render INSIDE this same form when on Step 1 so the Continue
             button can be type="submit". -->
        <form
          id="signup-step1-form"
          onsubmit={(e) => {
            e.preventDefault();
            continueFromStep1();
          }}
          class="space-y-4"
        >
          <p class="text-base opacity-80">{m.auth_signup_modal_step1_subtitle()}</p>

          <div class="form-control flex flex-col">
            <label class="label" for="signup-name-input">
              <span class="label-text">{m.auth_signup_modal_name_label()}</span>
            </label>
            <input
              id="signup-name-input"
              type="text"
              bind:value={userData.name}
              placeholder={m.auth_signup_modal_name_placeholder()}
              class="input-bordered input w-full"
              class:input-error={errors.name}
              autocomplete="off"
            />
            {#if errors.name}
              <div class="label">
                <span class="label-text-alt text-error">{errors.name}</span>
              </div>
            {/if}
            {#if errors.keyGeneration}
              <div class="label">
                <span class="label-text-alt text-error">{errors.keyGeneration}</span>
              </div>
            {/if}
          </div>
        </form>
      {:else if currentStep === 2}
        <div class="space-y-6">
          <p class="text-base opacity-80">{m.auth_signup_modal_step2_subtitle()}</p>

          <div class="flex flex-col items-center gap-4">
            <AvatarUploader bind:userData signer={_signer} bind:errors />

            <!-- URL input is a power-user fallback. AvatarUploader covers the
                 happy path; non-technical users were getting confused by an
                 always-visible URL field. Collapsed-by-default disclosure
                 keeps the affordance reachable without making it loud. -->
            <details
              data-testid="signup-picture-url-disclosure"
              class="collapse-arrow collapse w-full max-w-md bg-base-200"
            >
              <summary
                class="collapse-title cursor-pointer text-center text-sm font-medium opacity-70"
              >
                {m.auth_signup_modal_picture_url_disclosure()}
              </summary>
              <div class="collapse-content">
                <div class="form-control flex flex-col">
                  <label class="label" for="signup-picture-url-input">
                    <span class="label-text w-full text-center">
                      {m.auth_signup_modal_profile_picture_url()}
                    </span>
                  </label>
                  <input
                    id="signup-picture-url-input"
                    type="url"
                    bind:value={userData.picture}
                    placeholder={m.auth_signup_modal_profile_picture_placeholder()}
                    class="input-bordered input w-full text-center"
                  />
                  <div class="label">
                    <span class="label-text-alt w-full text-center opacity-70">
                      {m.auth_signup_modal_profile_picture_hint()}
                    </span>
                  </div>
                </div>
              </div>
            </details>
          </div>

          <div class="form-control flex flex-col">
            <label class="label" for="signup-about-textarea">
              <span class="label-text">{m.auth_signup_modal_about_label()}</span>
            </label>
            <textarea
              id="signup-about-textarea"
              bind:value={userData.about}
              placeholder={m.auth_signup_modal_about_placeholder()}
              class="textarea-bordered textarea h-24 w-full"
            ></textarea>
          </div>
        </div>
      {/if}
    </div>

    <div class="modal-action">
      <div class="flex w-full justify-end gap-2">
        {#if currentStep === 1}
          <form method="dialog">
            <button type="submit" class="btn">{m.common_cancel()}</button>
          </form>
          <!-- type="submit" + form="signup-step1-form" lets this button submit
               the Step 1 form even though it's rendered outside it (modal-action
               sits below the step body). Enter inside the name input also
               submits the same form, so we get keyboard parity for free. -->
          <button type="submit" form="signup-step1-form" class="btn btn-primary">
            {m.auth_signup_modal_continue()}
            <ChevronRightIcon />
          </button>
        {:else}
          <button class="btn btn-ghost" onclick={finishProfile} disabled={isPublishing}>
            {m.auth_signup_modal_skip()}
          </button>
          <button class="btn btn-primary" onclick={finishProfile} disabled={isPublishing}>
            {#if isPublishing}
              <span class="loading loading-sm loading-spinner"></span>
              {m.auth_signup_modal_creating_account()}
            {:else}
              {m.auth_signup_modal_done()}
            {/if}
          </button>
        {/if}
      </div>

      {#if errors.publishing}
        <div class="mt-4 alert alert-error">
          <span>{errors.publishing}</span>
        </div>
      {/if}
    </div>
  </div>
</dialog>
