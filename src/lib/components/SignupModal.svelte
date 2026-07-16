<script>
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import { SimpleAccount } from 'applesauce-accounts/accounts';
  import { generateSignupKeypair } from '$lib/helpers/signupKeypair.js';
  import { buildCommunityFollowSet } from '$lib/helpers/communityFollowSet.js';
  import { buildDmRelayListEvent } from '$lib/helpers/dm.js';
  import { getDefaultDmRelays } from '$lib/helpers/relay-helper.js';
  import { buildSignedDefaultRelayList } from '$lib/services/relay-list-backfill.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { nip19 } from 'nostr-tools';
  import { communikeyTimelineLoader } from '$lib/loaders/community.js';
  import ChevronRightIcon from './icons/ui/ChevronRightIcon.svelte';
  import AvatarUploader from './shared/AvatarUploader.svelte';
  import SignupCommunityPicker from './SignupCommunityPicker.svelte';
  import EducatorContextFields from './shared/EducatorContextFields.svelte';
  import MembershipApplicationForm from './membership/MembershipApplicationForm.svelte';

  let { modalId, externalSignup = false } = $props();

  // Educator-friendly wizard:
  //   Step 1 = name → creates SimpleAccount and activates it (user is logged in)
  //   Step 2 = optional profile polish (avatar + bio)
  //   Step 3 = optional educator context (kind-0 `edufeed` object + kind 10015 interests)
  //   Step 4 = community picker → finishSignup publishes kind 0 (+ optional 10015/30000)
  //   Step 5 = optional edufeed-handle application; only when membership is
  //            enabled — otherwise the modal closes right after finishSignup.
  // Backup file + suggested follows are deferred to post-login banners.
  let currentStep = $state(1);

  const membershipEnabled = $derived(!!runtimeConfig.membership?.enabled);

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

  /** @type {import('$lib/helpers/educational/educatorProfile.js').EdufeedProfile} */
  let edufeed = $state({ interests: [], educationalLevels: [], subjects: [], locations: [] });

  /** True once the user submitted the handle application on step 5. */
  let handleApplied = $state(false);

  /** Selected community pubkeys (hex). Lives here so finishSignup can read it. */
  let selected = $state.raw(new SvelteSet());

  /** Network pre-warm subscription (kind 10222). Plain `let` per CLAUDE.md $effect rules. */
  /** @type {import('rxjs').Subscription | undefined} */
  let prewarmSub;

  /**
   * One-shot guard for the community-seed effect. If a user lands on the
   * communities step we pre-check the configured suggested communities, but if
   * they then untick everything, `selected.size` returns to 0 — without this
   * flag the seed effect would re-trigger and silently put the suggestions
   * back. Reset in `resetState()` so re-opening the modal seeds again.
   */
  let hasSeededCommunities = false;

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
  // In externalSignup mode (Google/Pomegranate) the account already exists
  // and is active in `manager` — adopt its pubkey + signer instead of
  // generating a new keypair.
  $effect(() => {
    if (externalSignup) {
      const active = manager.active;
      if (active && !userData.publicKey) {
        userData.publicKey = active.pubkey;
        userData.npub = nip19.npubEncode(active.pubkey);
        _signer = /** @type {any} */ (active.signer);
      }
      return;
    }
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

  // Pre-warm the kind 10222 timeline as soon as the user is on step 2 so the
  // picker (mounted on step 4) finds events already populated. Normal teardown
  // happens via `resetState()` on close; the empty-deps effect below handles
  // the unmount-without-close path (e.g. parent route navigates away).
  $effect(() => {
    if (currentStep >= 2 && !prewarmSub) {
      prewarmSub = communikeyTimelineLoader()().subscribe();
    }
  });

  // Component-destroy cleanup. No reactive deps → runs once on mount and the
  // returned cleanup only fires on unmount, so we don't tear down the pre-warm
  // sub on every step transition.
  $effect(() => {
    return () => {
      prewarmSub?.unsubscribe();
      prewarmSub = undefined;
    };
  });

  // Pre-check suggested communities for the user. They can untick anything
  // before submitting; the network discovery in the picker still updates
  // `selected` via two-way bind. The `hasSeededCommunities` guard ensures we
  // seed only once per modal lifetime — without it, ticking everything off
  // would re-trigger this effect and silently re-seed.
  $effect(() => {
    if (currentStep === 4 && !hasSeededCommunities) {
      for (const pk of suggestedCommunityPubkeys()) selected.add(pk);
      hasSeededCommunities = true;
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
    selected = new SvelteSet();
    hasSeededCommunities = false;
    edufeed = { interests: [], educationalLevels: [], subjects: [], locations: [] };
    handleApplied = false;
    prewarmSub?.unsubscribe();
    prewarmSub = undefined;
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
    if (!externalSignup) {
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
      // (extension, paste-in nsec, returning sessions) aren't bothered. Bunker
      // signers (externalSignup) have no `.key`, so the nsec-backup banner
      // that reads this flag would have nothing to back up — skip it there.
      try {
        localStorage.setItem(`signed-up-here:${userData.publicKey}`, '1');
      } catch {
        /* localStorage may be unavailable in some embeds; banners simply won't show */
      }
    } else if (!userData.publicKey || !_signer) {
      errors.keyGeneration = 'Account not ready. Please wait a moment and try again.';
      return;
    }

    currentStep = 2;
  }

  /**
   * Step 2 → Step 3: advance without publishing.
   */
  function continueFromStep2() {
    errors = {};
    currentStep = 3;
  }

  /**
   * Step 3 → Step 4: advance without publishing. All context fields are
   * optional, so Continue works with everything left empty.
   */
  function continueFromStep3() {
    errors = {};
    currentStep = 4;
  }

  /** @param {string} id */
  function normalizeIdToHex(id) {
    if (!id || typeof id !== 'string') return null;
    if (/^[0-9a-f]{64}$/i.test(id)) return id.toLowerCase();
    if (!id.startsWith('npub1')) return null;
    try {
      const decoded = nip19.decode(id);
      return decoded.type === 'npub' ? /** @type {string} */ (decoded.data) : null;
    } catch {
      return null;
    }
  }

  function suggestedCommunityPubkeys() {
    const ids = runtimeConfig.signup?.suggestedCommunities || [];
    return ids.map(normalizeIdToHex).filter(/** @returns {pk is string} */ (pk) => pk !== null);
  }

  /**
   * Step 4: build + sign kind 0 (and optionally kind 30000), apply optimistically
   * to EventStore, fire-and-forget publish. Publish happens here for the first
   * time. Afterwards the modal either closes or — when membership is enabled —
   * advances to the optional handle-application step.
   *
   * @param {{ skipCommunities?: boolean }} [opts]
   */
  async function finishSignup({ skipCommunities = false } = {}) {
    if (!_signer || !userData.publicKey) {
      errors.publishing = 'Account not ready.';
      return;
    }
    try {
      isPublishing = true;

      const profileContent = /** @type {Record<string, unknown>} */ ({});
      if (userData.name) profileContent.name = userData.name;
      if (userData.about) profileContent.about = userData.about;
      if (userData.picture) profileContent.picture = userData.picture;
      // Interests live in the NIP-51 kind 10015 list; the kind-0 edufeed
      // object only carries the SKOS concepts that don't fit flat t tags.
      if (
        edufeed.educationalLevels.length ||
        edufeed.subjects.length ||
        edufeed.locations?.length
      ) {
        profileContent.edufeed = {
          educationalLevels: edufeed.educationalLevels,
          subjects: edufeed.subjects,
          locations: edufeed.locations
        };
      }

      const metadataEvent = {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify(profileContent),
        pubkey: userData.publicKey
      };
      const signedMetadata = await _signer.signEvent(metadataEvent);

      const signedInterestsList = edufeed.interests.length
        ? await _signer.signEvent({
            kind: 10015,
            created_at: Math.floor(Date.now() / 1000),
            tags: edufeed.interests.map((interest) => ['t', interest]),
            content: '',
            pubkey: userData.publicKey
          })
        : null;

      const pubkeys = skipCommunities ? [] : Array.from(selected);
      const { signed: signedFollowSet, targetPubkeys } = pubkeys.length
        ? await buildCommunityFollowSet(/** @type {any} */ (_signer), userData.publicKey, pubkeys)
        : { signed: null, targetPubkeys: [] };

      const dmRelays = getDefaultDmRelays();
      const signedDmRelayList = dmRelays.length
        ? await _signer.signEvent(buildDmRelayListEvent(userData.publicKey, dmRelays))
        : null;

      const signedRelayList = await buildSignedDefaultRelayList(_signer);

      // Optimistic local apply.
      eventStore.add(signedMetadata);
      if (signedInterestsList) eventStore.add(signedInterestsList);
      if (signedFollowSet) eventStore.add(signedFollowSet);
      if (signedDmRelayList) eventStore.add(signedDmRelayList);
      if (signedRelayList) eventStore.add(signedRelayList);

      isPublishing = false;
      if (membershipEnabled) {
        // Signup is complete; offer the optional handle application while the
        // user is still in the flow. Closing at any point is fine.
        currentStep = 5;
      } else {
        closeModal();
      }

      // Background publish.
      publishEvent(signedMetadata).catch((err) => console.warn('kind 0 publish failed:', err));
      if (signedInterestsList) {
        publishEvent(signedInterestsList).catch((err) =>
          console.warn('kind 10015 publish failed:', err)
        );
      }
      if (signedFollowSet) {
        publishEvent(signedFollowSet, targetPubkeys).catch((err) =>
          console.warn('kind 30000 publish failed:', err)
        );
      }
      if (signedDmRelayList) {
        publishEvent(signedDmRelayList).catch((err) =>
          console.warn('kind 10050 publish failed:', err)
        );
      }
      if (signedRelayList) {
        publishEvent(signedRelayList).catch((err) =>
          console.warn('kind 10002 publish failed:', err)
        );
      }
    } catch (err) {
      console.error('Signup publish failed:', err);
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
        <li class="step {currentStep >= 3 ? 'step-primary' : ''}">
          {m.auth_signup_modal_step_context()}
        </li>
        <li class="step {currentStep >= 4 ? 'step-primary' : ''}">
          {m.auth_signup_modal_step3_communities()}
        </li>
        {#if membershipEnabled}
          <li class="step {currentStep >= 5 ? 'step-primary' : ''}">
            {m.auth_signup_modal_step_handle()}
          </li>
        {/if}
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
      {:else if currentStep === 3}
        <div class="space-y-4">
          <p class="text-base opacity-80">{m.auth_signup_modal_context_subtitle()}</p>
          <EducatorContextFields value={edufeed} compact onchange={(value) => (edufeed = value)} />
        </div>
      {:else if currentStep === 4}
        <SignupCommunityPicker bind:selected />
      {:else if currentStep === 5}
        <div class="space-y-4">
          <p class="text-base opacity-80">{m.auth_signup_modal_handle_subtitle()}</p>
          <p class="text-sm opacity-70">{m.auth_signup_modal_handle_optional_hint()}</p>
          <MembershipApplicationForm onsubmitted={() => (handleApplied = true)} />
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
        {:else if currentStep === 2}
          <button class="btn btn-primary" onclick={continueFromStep2}>
            {m.auth_signup_modal_continue()}
            <ChevronRightIcon />
          </button>
        {:else if currentStep === 3}
          <button
            class="btn btn-primary"
            data-testid="signup-context-continue"
            onclick={continueFromStep3}
          >
            {m.auth_signup_modal_continue()}
            <ChevronRightIcon />
          </button>
        {:else if currentStep === 4}
          <button
            class="btn btn-ghost"
            data-testid="signup-skip-communities"
            onclick={() => finishSignup({ skipCommunities: true })}
            disabled={isPublishing}
          >
            {m.auth_signup_modal_step3_skip()}
          </button>
          <button class="btn btn-primary" onclick={() => finishSignup()} disabled={isPublishing}>
            {#if isPublishing}
              <span class="loading loading-sm loading-spinner"></span>
              {m.auth_signup_modal_creating_account()}
            {:else}
              {m.auth_signup_modal_step3_done()}
            {/if}
          </button>
        {:else}
          <!-- Step 5: account already exists and the kind 0 is published, so
               the only action is leaving — either before applying ("Später
               beantragen") or after ("Fertig"). -->
          {#if handleApplied}
            <button class="btn btn-primary" data-testid="signup-handle-done" onclick={closeModal}>
              {m.auth_signup_modal_done()}
            </button>
          {:else}
            <button class="btn btn-ghost" data-testid="signup-skip-handle" onclick={closeModal}>
              {m.auth_signup_modal_membership_skip()}
            </button>
          {/if}
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
