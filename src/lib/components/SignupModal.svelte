<script>
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import { SimpleSigner } from 'applesauce-signers';
  import { SimpleAccount } from 'applesauce-accounts/accounts';
  import { nip19, generateSecretKey, getPublicKey } from 'nostr-tools';
  import * as nip49 from 'nostr-tools/nip49';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { fetchProfileData } from '$lib/helpers/profile.js';
  import ImageWithFallback from './shared/ImageWithFallback.svelte';
  import CopyIcon from './icons/actions/CopyIcon.svelte';
  import CheckIcon from './icons/ui/CheckIcon.svelte';
  import ChevronLeftIcon from './icons/ui/ChevronLeftIcon.svelte';
  import ChevronRightIcon from './icons/ui/ChevronRightIcon.svelte';

  let { modalId } = $props();

  // Step management
  let currentStep = $state(1);
  const totalSteps = 4;

  // User data state
  let userData = $state({
    name: '',
    about: '',
    picture: '',
    website: '',
    privateKey: /** @type {Uint8Array | null} */ (null),
    publicKey: '',
    nsec: '',
    npub: '',
    selectedFollows: /** @type {any[]} */ ([]),
    downloadConfirmed: false,
    ncryptsecPassword: '',
    useEncryption: false
  });

  // UI state
  let isGeneratingKeys = $state(false);
  let isPublishing = $state(false);
  let errors = $state(/** @type {Record<string, string>} */ ({}));
  let _signer = $state(/** @type {SimpleSigner | null} */ (null));

  // No complex profile state needed - #await handles everything!

  /**
   * Sync modal close with store state
   * This effect ensures that when the dialog closes (via ESC, backdrop, etc.),
   * the modal store state is updated accordingly
   */
  $effect(() => {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (!dialog) return;

    const handleDialogClose = () => {
      // Prevent closing during key generation or publishing
      if (isGeneratingKeys || isPublishing) {
        // Re-open the dialog if it was closed during an operation
        dialog.showModal();
        return;
      }
      // Only update store if this modal is currently active
      if (modalStore.activeModal === 'signup') {
        console.log('SignupModal: Dialog closed, syncing with store');
        modalStore.closeModal();
        // Reset state on close
        currentStep = 1;
        userData = {
          name: '',
          about: '',
          picture: '',
          website: '',
          privateKey: /** @type {Uint8Array | null} */ (null),
          publicKey: '',
          nsec: '',
          npub: '',
          selectedFollows: /** @type {any[]} */ ([]),
          downloadConfirmed: false,
          ncryptsecPassword: '',
          useEncryption: false
        };
        errors = {};
        _signer = null;
      }
    };

    dialog.addEventListener('close', handleDialogClose);
    return () => {
      dialog.removeEventListener('close', handleDialogClose);
    };
  });

  // Generate keypair when entering step 3
  $effect(() => {
    if (currentStep === 3 && !userData.privateKey) {
      generateKeypair();
    }
  });

  function generateKeypair() {
    try {
      isGeneratingKeys = true;
      const privateKey = generateSecretKey();
      const publicKey = getPublicKey(privateKey);

      userData.privateKey = privateKey;
      userData.publicKey = publicKey;
      userData.nsec = nip19.nsecEncode(privateKey);
      userData.npub = nip19.npubEncode(publicKey);

      // Create signer for future operations (like image upload with auth)
      _signer = /** @type {any} */ (new SimpleSigner(privateKey));
    } catch (error) {
      console.error('Error generating keypair:', error);
      errors.keyGeneration = 'Failed to generate keys. Please try again.';
    } finally {
      isGeneratingKeys = false;
    }
  }

  /**
   * @param {string} content
   * @param {string} filename
   * @param {string} mimeType
   */
  function downloadFile(content, filename, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadNsec() {
    downloadFile(userData.nsec, 'nostr-private-key.txt');
    userData.downloadConfirmed = true;
  }

  function downloadNcryptsec() {
    if (!userData.ncryptsecPassword) {
      errors.password = 'Please enter a password for encryption';
      return;
    }

    if (!userData.privateKey) {
      errors.password = 'Private key not available';
      return;
    }

    try {
      // Use proper NIP-49 encryption
      const ncryptsec = nip49.encrypt(userData.privateKey, userData.ncryptsecPassword);
      downloadFile(ncryptsec, 'nostr-encrypted-key.txt');
      userData.downloadConfirmed = true;
      errors.password = '';
    } catch (error) {
      console.error('NIP-49 encryption failed:', error);
      errors.password = 'Failed to create encrypted key';
    }
  }

  /**
   * @param {any} user
   */
  function toggleFollowUser(user) {
    const index = userData.selectedFollows.findIndex((u) => u.npub === user.npub);
    if (index >= 0) {
      userData.selectedFollows.splice(index, 1);
    } else {
      userData.selectedFollows.push(user);
    }
  }

  /**
   * @param {string} text
   */
  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      // Could add a toast notification here
    });
  }

  /**
   * @param {number} step
   */
  function validateStep(step) {
    errors = {};

    switch (step) {
      case 2:
        if (!userData.name.trim()) {
          errors.name = 'Name is required';
          return false;
        }
        break;
      case 3:
        if (!userData.downloadConfirmed) {
          errors.download = 'Please download your private key before continuing';
          return false;
        }
        break;
    }
    return true;
  }

  function nextStep() {
    if (!validateStep(currentStep)) return;

    if (currentStep < totalSteps) {
      currentStep++;
    }
  }

  function prevStep() {
    if (currentStep > 1) {
      currentStep--;
    }
  }

  async function publishProfile() {
    try {
      isPublishing = true;

      if (!userData.privateKey || !userData.publicKey) {
        throw new Error('Keys not generated');
      }

      // Create signer and account
      const signer = new SimpleSigner(userData.privateKey);
      const account = new SimpleAccount(userData.publicKey, signer);

      // Create metadata event (Kind 0)
      const metadata = {
        name: userData.name,
        about: userData.about,
        picture: userData.picture,
        website: userData.website
      };

      const metadataEvent = {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify(metadata),
        pubkey: userData.publicKey
      };

      // Sign the event
      const signedMetadataEvent = await signer.signEvent(metadataEvent);

      // Create contacts event (Kind 3) if users selected
      let signedContactsEvent = null;
      if (userData.selectedFollows.length > 0) {
        const contactTags = userData.selectedFollows.map((user) => {
          const decoded = nip19.decode(user.npub);
          return ['p', String(decoded.data)];
        });

        const contactsEvent = {
          kind: 3,
          created_at: Math.floor(Date.now() / 1000),
          tags: contactTags,
          content: '',
          pubkey: userData.publicKey
        };

        signedContactsEvent = await signer.signEvent(contactsEvent);
      }

      // Publish metadata event (kind 0) using outbox model
      const metadataResult = await publishEvent(signedMetadataEvent);
      if (metadataResult.success) {
        eventStore.add(signedMetadataEvent);
      }

      // Publish contacts event (kind 3) if users selected
      let contactsSuccess = true;
      if (signedContactsEvent) {
        // Extract tagged pubkeys from contacts for outbox model
        const taggedPubkeys = userData.selectedFollows.map((/** @type {any} */ user) => {
          const decoded = nip19.decode(user.npub);
          return String(decoded.data);
        });
        const contactsResult = await publishEvent(signedContactsEvent, taggedPubkeys);
        contactsSuccess = contactsResult.success;
        if (contactsResult.success) {
          eventStore.add(signedContactsEvent);
        }
      }

      if (metadataResult.success || contactsSuccess) {
        // Add account to manager after successful publishing
        if (!manager.getAccountForPubkey(userData.publicKey)) {
          manager.addAccount(account);
          manager.setActive(account);
        }

        console.log('SignupModal: Successfully published profile events');

        // Close modal and show success
        closeModal();
      } else {
        throw new Error('Failed to publish profile to any relay');
      }
    } catch (error) {
      console.error('Error publishing profile:', error);
      errors.publishing = 'Failed to create account. Please try again.';
    } finally {
      isPublishing = false;
    }
  }

  function closeModal() {
    // Prevent closing during key generation or publishing
    if (isGeneratingKeys || isPublishing) return;
    modalStore.closeModal();
    // Reset state
    currentStep = 1;
    userData = {
      name: '',
      about: '',
      picture: '',
      website: '',
      privateKey: /** @type {Uint8Array | null} */ (null),
      publicKey: '',
      nsec: '',
      npub: '',
      selectedFollows: /** @type {any[]} */ ([]),
      downloadConfirmed: false,
      ncryptsecPassword: '',
      useEncryption: false
    };
    errors = {};
    _signer = null;
  }
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box max-w-2xl">
    <!-- Header with steps -->
    <div class="mb-6">
      <h1 class="mb-4 text-2xl font-bold">{m.auth_signup_modal_title()}</h1>

      <!-- Step indicator -->
      <ul class="steps w-full">
        <li class="step {currentStep >= 1 ? 'step-primary' : ''}">
          {m.auth_signup_modal_step_introduction()}
        </li>
        <li class="step {currentStep >= 2 ? 'step-primary' : ''}">
          {m.auth_signup_modal_step_profile()}
        </li>
        <li class="step {currentStep >= 3 ? 'step-primary' : ''}">
          {m.auth_signup_modal_step_keys()}
        </li>
        <li class="step {currentStep >= 4 ? 'step-primary' : ''}">
          {m.auth_signup_modal_step_follow()}
        </li>
      </ul>
    </div>

    <!-- Step content -->
    <div class="min-h-96">
      {#if currentStep === 1}
        <!-- Introduction Step -->
        <div class="prose max-w-none">
          <p class="mb-4 text-lg">
            {m.auth_signup_modal_intro_p1()}
          </p>
          <p class="mb-4">
            {m.auth_signup_modal_intro_p2()}
          </p>
          <p class="mb-6">
            {m.auth_signup_modal_intro_p3()}
          </p>
        </div>
      {:else if currentStep === 2}
        <!-- Profile Creation Step -->
        <div class="space-y-6">
          <h2 class="mb-6 text-center text-xl font-semibold">
            {m.auth_signup_modal_create_profile_title()}
          </h2>

          <!-- Avatar URL Input (centered) -->
          <div class="flex flex-col items-center gap-4">
            <!-- Circular Avatar Preview -->
            <div
              class="h-32 w-32 overflow-hidden rounded-full border-4 border-base-200 bg-base-300 shadow-lg"
            >
              {#if userData.picture}
                <img
                  src={userData.picture}
                  alt="Profile Preview"
                  class="h-full w-full object-cover"
                  onerror={(e) => {
                    // @ts-ignore
                    e.currentTarget.style.display = 'none';
                  }}
                />
              {:else}
                <!-- User icon placeholder -->
                <div class="flex h-full w-full items-center justify-center text-base-content/30">
                  <svg class="h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="1.5"
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                </div>
              {/if}
            </div>

            <!-- URL Input Field -->
            <div class="form-control flex w-full max-w-md flex-col">
              <label class="label" for="profile-picture-url-input">
                <span class="label-text w-full text-center"
                  >{m.auth_signup_modal_profile_picture_url()}</span
                >
              </label>
              <input
                id="profile-picture-url-input"
                type="url"
                bind:value={userData.picture}
                placeholder={m.auth_signup_modal_profile_picture_placeholder()}
                class="input-bordered input w-full text-center"
              />
              <div class="label">
                <span class="label-text-alt w-full text-center opacity-70"
                  >{m.auth_signup_modal_profile_picture_hint()}</span
                >
              </div>
            </div>
          </div>

          <!-- Form fields container (centered) -->
          <div class="flex w-full flex-col items-center">
            <div class="w-full max-w-md space-y-4">
              <!-- Name -->
              <div class="form-control flex flex-col">
                <label class="label" for="profile-name-input">
                  <span class="label-text w-full text-center"
                    >{m.auth_signup_modal_name_label()}</span
                  >
                </label>
                <input
                  id="profile-name-input"
                  type="text"
                  bind:value={userData.name}
                  placeholder={m.auth_signup_modal_name_placeholder()}
                  class="input-bordered input w-full"
                  class:input-error={errors.name}
                />
                {#if errors.name}
                  <div class="label">
                    <span class="label-text-alt w-full text-center text-error">{errors.name}</span>
                  </div>
                {/if}
              </div>

              <!-- About -->
              <div class="form-control flex flex-col">
                <label class="label" for="profile-about-textarea">
                  <span class="label-text w-full text-center"
                    >{m.auth_signup_modal_about_label()}</span
                  >
                </label>
                <textarea
                  id="profile-about-textarea"
                  bind:value={userData.about}
                  placeholder={m.auth_signup_modal_about_placeholder()}
                  class="textarea-bordered textarea h-24 w-full"
                ></textarea>
              </div>

              <!-- Website -->
              <div class="form-control flex flex-col">
                <label class="label" for="profile-website-input">
                  <span class="label-text w-full text-center"
                    >{m.auth_signup_modal_website_label()}</span
                  >
                </label>
                <input
                  id="profile-website-input"
                  type="url"
                  bind:value={userData.website}
                  placeholder={m.auth_signup_modal_website_placeholder()}
                  class="input-bordered input w-full"
                />
              </div>
            </div>
          </div>
        </div>
      {:else if currentStep === 3}
        <!-- Keys Management Step -->
        <div class="space-y-6">
          <div class="prose max-w-none">
            <h2 class="mb-4 text-xl font-semibold">
              {m.auth_signup_modal_keys_title({ name: userData.name })}
            </h2>
            <p class="mb-4">
              {m.auth_signup_modal_keys_p1()}
            </p>
            <p class="mb-6">
              {m.auth_signup_modal_keys_p2()}
            </p>
            <p class="mb-6 font-semibold text-warning">
              {m.auth_signup_modal_keys_warning()}
            </p>
          </div>

          {#if isGeneratingKeys}
            <div class="flex items-center justify-center py-8">
              <span class="loading loading-lg loading-spinner"></span>
              <span class="ml-2">{m.auth_signup_modal_generating_keys()}</span>
            </div>
          {:else}
            <!-- Public Key Display -->
            <div class="card bg-base-200">
              <div class="card-body">
                <h3 class="card-title text-sm">{m.auth_signup_modal_public_key_label()}</h3>
                <div class="flex items-center gap-2">
                  <code class="flex-1 rounded bg-base-300 p-2 text-xs break-all">
                    {userData.npub}
                  </code>
                  <button
                    class="btn btn-square btn-sm"
                    onclick={() => copyToClipboard(userData.npub)}
                  >
                    <CopyIcon />
                  </button>
                </div>
              </div>
            </div>

            <!-- Private Key Download -->
            <div class="card bg-base-200">
              <div class="card-body">
                <h3 class="card-title text-sm">
                  {m.auth_signup_modal_private_key_download_title()}
                </h3>

                <div class="space-y-4">
                  <!-- Plain nsec download -->
                  <div>
                    <button
                      class="btn btn-primary"
                      onclick={downloadNsec}
                      disabled={userData.downloadConfirmed}
                    >
                      {#if userData.downloadConfirmed}
                        <CheckIcon />
                        {m.auth_signup_modal_downloaded()}
                      {:else}
                        {m.auth_signup_modal_download_nsec()}
                      {/if}
                    </button>
                  </div>

                  <!-- Encrypted option -->
                  <div class="divider">OR</div>

                  <div class="space-y-2">
                    <label class="label" for="encrypted-password-input">
                      <span class="label-text">{m.auth_signup_modal_encrypted_backup_label()}</span>
                    </label>
                    <div class="flex gap-2">
                      <input
                        id="encrypted-password-input"
                        type="password"
                        bind:value={userData.ncryptsecPassword}
                        placeholder={m.auth_signup_modal_password_placeholder()}
                        class="input-bordered input flex-1"
                        class:input-error={errors.password}
                      />
                      <button
                        class="btn btn-secondary"
                        onclick={downloadNcryptsec}
                        disabled={!userData.ncryptsecPassword || userData.downloadConfirmed}
                      >
                        {#if userData.downloadConfirmed}
                          <CheckIcon />
                          {m.auth_signup_modal_downloaded()}
                        {:else}
                          {m.auth_signup_modal_download_ncryptsec()}
                        {/if}
                      </button>
                    </div>
                    {#if errors.password}
                      <div class="label">
                        <span class="label-text-alt text-error">{errors.password}</span>
                      </div>
                    {/if}
                  </div>
                </div>
              </div>
            </div>

            {#if errors.download}
              <div class="alert alert-error">
                <span>{errors.download}</span>
              </div>
            {/if}
          {/if}
        </div>
      {:else if currentStep === 4}
        <!-- Follow Suggestions Step -->
        <div class="space-y-4">
          <h2 class="mb-4 text-xl font-semibold">{m.auth_signup_modal_follow_title()}</h2>
          <p class="mb-6 text-sm opacity-70">
            {m.auth_signup_modal_follow_description()}
          </p>

          <div class="space-y-3">
            {#each runtimeConfig.signup.suggestedUsers as npub (npub)}
              {#await fetchProfileData(npub)}
                <!-- Loading state for this profile -->
                <div class="card bg-base-200">
                  <div class="card-body p-4">
                    <div class="flex items-center gap-4">
                      <div class="avatar">
                        <div class="h-12 w-12 animate-pulse rounded-full bg-gray-300"></div>
                      </div>
                      <div class="flex-1">
                        <div class="mb-2 h-4 animate-pulse rounded bg-gray-300"></div>
                        <div class="h-3 w-2/3 animate-pulse rounded bg-gray-300"></div>
                      </div>
                      <div class="h-5 w-5 animate-pulse rounded bg-gray-300"></div>
                    </div>
                  </div>
                </div>
              {:then profile}
                <!-- Profile loaded successfully -->
                <div class="card bg-base-200">
                  <div class="card-body p-4">
                    <div class="flex items-center gap-4">
                      <div class="avatar">
                        <div class="w-12 rounded-full">
                          <ImageWithFallback
                            src={profile.picture}
                            alt={profile.name || ''}
                            size="avatar_lg"
                            class="h-full w-full rounded-full object-cover"
                          />
                        </div>
                      </div>
                      <div class="flex-1">
                        <h3 class="font-semibold">{profile.name}</h3>
                        <p class="text-sm opacity-70">{profile.about}</p>
                      </div>
                      <input
                        type="checkbox"
                        class="checkbox checkbox-primary"
                        checked={userData.selectedFollows.some((u) => u.npub === profile.npub)}
                        onchange={() => toggleFollowUser(profile)}
                      />
                    </div>
                  </div>
                </div>
              {:catch _error}
                <!-- Error loading this profile -->
                <div class="card bg-base-200 opacity-50">
                  <div class="card-body p-4">
                    <div class="flex items-center gap-4">
                      <div class="avatar">
                        <div class="w-12 rounded-full bg-gray-400">
                          <div
                            class="flex h-full w-full items-center justify-center text-xs text-white"
                          >
                            ?
                          </div>
                        </div>
                      </div>
                      <div class="flex-1">
                        <h3 class="font-semibold text-gray-500">
                          {m.auth_signup_modal_profile_load_failed()}
                        </h3>
                        <p class="text-sm text-gray-400">
                          {m.auth_signup_modal_profile_fetch_error()}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              {/await}
            {/each}
          </div>

          {#if userData.selectedFollows.length > 0}
            <div class="alert alert-info">
              <span
                >{m.auth_signup_modal_selected_count({
                  count: userData.selectedFollows.length,
                  plural: userData.selectedFollows.length === 1 ? '' : 's'
                })}</span
              >
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Navigation -->
    <div class="modal-action">
      <div class="flex w-full justify-between">
        <div>
          {#if currentStep > 1}
            <button class="btn btn-ghost" onclick={prevStep}>
              <ChevronLeftIcon />
              {m.common_back()}
            </button>
          {/if}
        </div>

        <div class="flex gap-2">
          <form method="dialog">
            <button class="btn">{m.common_cancel()}</button>
          </form>

          {#if currentStep < totalSteps}
            <button class="btn btn-primary" onclick={nextStep}>
              {m.common_next()}
              <ChevronRightIcon />
            </button>
          {:else}
            <button class="btn btn-primary" onclick={publishProfile} disabled={isPublishing}>
              {#if isPublishing}
                <span class="loading loading-sm loading-spinner"></span>
                {m.auth_signup_modal_creating_account()}
              {:else}
                {m.auth_signup_modal_finish()}
              {/if}
            </button>
          {/if}

          {#if errors.publishing}
            <div class="mt-4 alert alert-error">
              <span>{errors.publishing}</span>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
</dialog>
