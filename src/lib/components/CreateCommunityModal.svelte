<script>
  import * as m from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { manager } from '$lib/stores/accounts.svelte';
  import { SimpleSigner } from 'applesauce-signers';
  import { SimpleAccount } from 'applesauce-accounts/accounts';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { hexToNpub } from '$lib/helpers/nostrUtils.js';
  import ChevronLeftIcon from './icons/ui/ChevronLeftIcon.svelte';
  import ChevronRightIcon from './icons/ui/ChevronRightIcon.svelte';
  import KeypairGenerator from './shared/KeypairGenerator.svelte';
  import ImageUploader from './shared/ImageUploader.svelte';
  import ProfileForm from './shared/ProfileForm.svelte';
  import EditableList from './shared/EditableList.svelte';
  import LocationInput from './shared/LocationInput.svelte';
  import ContentTypesAndACL from './shared/ContentTypesAndACL.svelte';
  import { buildCommunityDefinitionTags } from '$lib/helpers/communityTagBuilder.js';
  import { useFormTemplates } from '$lib/stores/form-templates.svelte.js';
  import { parseFormTemplate, createDefaultMembershipForm } from '$lib/helpers/forms.js';

  let { modalId } = $props();

  // Step management - improved flow
  let currentStep = $state(0); // 0 = keypair selection, 1+ = actual steps
  let useCurrentKeypair = $state(false);

  // Dynamic step count based on choice (after keypair selection)
  let totalSteps = $derived.by(() => {
    if (currentStep === 0) return 0; // No stepper during selection
    return useCurrentKeypair ? 2 : 4; // Current: 2 steps, New: 4 steps
  });

  // Current step display (adjusted for stepper)
  let displayStep = $derived.by(() => {
    if (currentStep === 0) return 0;
    return useCurrentKeypair ? currentStep : currentStep - 1; // New keypair starts from step 1 after profile
  });

  // User data state for new keypair creation
  let userData = $state({
    name: '',
    about: '',
    picture: '',
    website: '',
    privateKey: /** @type {Uint8Array | null} */ (null),
    publicKey: '',
    nsec: '',
    npub: '',
    downloadConfirmed: false,
    ncryptsecPassword: '',
    useEncryption: false
  });

  // Community data state
  let communityData = $state({
    relays: ['wss://relay.edufeed.org'],
    blossomServers: ['blossom.edufeed.org'],
    location: '',
    description: '',
    contentTypes: {
      calendar: {
        name: 'Calendar',
        enabled: true,
        badges: { read: null, write: null },
        relays: [],
        formRef: ''
      },
      chat: {
        name: 'Chat',
        enabled: true,
        badges: { read: null, write: null },
        relays: [],
        formRef: ''
      },
      articles: {
        name: 'Articles',
        enabled: true,
        badges: { read: null, write: null },
        relays: [],
        formRef: ''
      },
      posts: {
        name: 'Forum',
        enabled: true,
        badges: { read: null, write: null },
        relays: [],
        formRef: ''
      },
      wikis: {
        name: 'Wikis',
        enabled: true,
        badges: { read: null, write: null },
        relays: [],
        formRef: ''
      }
    }
  });

  // Toggle for access control configuration
  let showAccessConfig = $state(false);
  let defaultFormRef = $state('');
  // Form templates for access gating (community pubkey + logged-in user)
  const getFormTemplates = useFormTemplates(() => {
    const communityPk = useCurrentKeypair ? manager.active?.pubkey : userData.publicKey;
    const userPk = manager.active?.pubkey;
    /** @type {string[]} */
    const authors = communityPk ? [communityPk] : [];
    if (userPk && userPk !== communityPk) authors.push(userPk);
    return authors;
  });

  /**
   * Resolve a formRef ("kind:pubkey:dTag") to its display name.
   * @param {string} ref
   * @returns {string}
   */
  function getFormName(ref) {
    if (!ref) return '';
    const [kind, pubkey, dTag] = ref.split(':');
    const template = getFormTemplates().find((t) => {
      const parsed = parseFormTemplate(t);
      return String(t.kind) === kind && t.pubkey === pubkey && parsed.dTag === dTag;
    });
    if (!template) return dTag || ref;
    const parsed = parseFormTemplate(template);
    return parsed.name || parsed.dTag || ref;
  }

  // UI state
  let isPublishing = $state(false);
  let errors = $state(/** @type {Record<string, string>} */ ({}));

  /**
   * Sync modal close with store state
   * This effect ensures that when the dialog closes (via ESC, backdrop, etc.),
   * the modal store state is updated accordingly
   */
  $effect(() => {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (!dialog) return;

    const handleDialogClose = () => {
      // Prevent closing during publishing
      if (isPublishing) {
        // Re-open the dialog if it was closed during publishing
        dialog.showModal();
        return;
      }
      // Only update store if this modal is currently active
      if (modalStore.activeModal === 'createCommunity') {
        console.log('CreateCommunityModal: Dialog closed, syncing with store');
        modalStore.closeModal();
        // Reset state on close
        currentStep = 0;
        useCurrentKeypair = false;
        userData = {
          name: '',
          about: '',
          picture: '',
          website: '',
          privateKey: /** @type {Uint8Array | null} */ (null),
          publicKey: '',
          nsec: '',
          npub: '',
          downloadConfirmed: false,
          ncryptsecPassword: '',
          useEncryption: false
        };
        communityData = {
          relays: ['wss://relay.edufeed.org'],
          blossomServers: ['blossom.edufeed.org'],
          location: '',
          description: '',
          contentTypes: {
            calendar: {
              name: 'Calendar',
              enabled: true,
              badges: { read: null, write: null },
              relays: [],
              formRef: ''
            },
            chat: {
              name: 'Chat',
              enabled: true,
              badges: { read: null, write: null },
              relays: [],
              formRef: ''
            },
            articles: {
              name: 'Articles',
              enabled: true,
              badges: { read: null, write: null },
              relays: [],
              formRef: ''
            },
            posts: {
              name: 'Forum',
              enabled: true,
              badges: { read: null, write: null },
              relays: [],
              formRef: ''
            },
            wikis: {
              name: 'Wikis',
              enabled: true,
              badges: { read: null, write: null },
              relays: [],
              formRef: ''
            }
          }
        };
        showAccessConfig = false;
        defaultFormRef = '';
        errors = {};
      }
    };

    dialog.addEventListener('close', handleDialogClose);
    return () => {
      dialog.removeEventListener('close', handleDialogClose);
    };
  });

  /**
   * @param {number} step
   */
  function validateStep(step) {
    errors = {};

    // For current keypair flow, validate community settings in step 1
    if (useCurrentKeypair && step === 1) {
      if (communityData.relays.length === 0) {
        errors.relays = m.create_community_modal_error_relays_required();
        return false;
      }

      // Check if at least one content type is selected
      const hasContentType = Object.values(communityData.contentTypes).some((ct) => ct.enabled);
      if (!hasContentType) {
        errors.contentTypes = m.create_community_modal_error_content_types_required();
        return false;
      }
    }

    // For new keypair flow, validate profile in step 1
    if (!useCurrentKeypair && step === 1) {
      if (!userData.name.trim()) {
        errors.name = m.create_community_modal_error_name_required();
        return false;
      }
    }

    // For new keypair flow, validate key download in step 2
    if (!useCurrentKeypair && step === 2) {
      if (!userData.downloadConfirmed) {
        errors.download = m.create_community_modal_error_download_required();
        return false;
      }
    }

    // For new keypair flow, validate community settings in step 3
    if (!useCurrentKeypair && step === 3) {
      if (communityData.relays.length === 0) {
        errors.relays = m.create_community_modal_error_relays_required();
        return false;
      }

      // Check if at least one content type is selected
      const hasContentType = Object.values(communityData.contentTypes).some((ct) => ct.enabled);
      if (!hasContentType) {
        errors.contentTypes = m.create_community_modal_error_content_types_required();
        return false;
      }
    }

    return true;
  }

  // Get step labels based on flow
  function getStepLabels() {
    if (useCurrentKeypair) {
      return [
        m.create_community_modal_step_community_settings(),
        m.create_community_modal_step_confirm()
      ];
    } else {
      return [
        m.create_community_modal_step_profile(),
        m.create_community_modal_step_keys(),
        m.create_community_modal_step_community_settings(),
        m.create_community_modal_step_confirm()
      ];
    }
  }

  /**
   * Validate relay URL format
   * @param {string} url
   */
  function validateRelayUrl(url) {
    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      return m.create_community_modal_relays_validation();
    }
    try {
      new URL(url);
      return null;
    } catch {
      return m.create_community_modal_error_invalid_url();
    }
  }

  function nextStep() {
    if (!validateStep(currentStep)) return;

    const maxSteps = useCurrentKeypair ? 2 : 4;
    if (currentStep < maxSteps) {
      currentStep++;
    }
  }

  function prevStep() {
    if (currentStep > 1) {
      currentStep--;
    }
  }

  function selectCurrentKeypair() {
    useCurrentKeypair = true;
    nextStep();
  }

  function selectNewKeypair() {
    useCurrentKeypair = false;
    nextStep();
  }

  async function handleCreateDefaultForm() {
    /** @type {import('applesauce-signers').ISigner} */
    let signer;
    if (useCurrentKeypair) {
      signer = /** @type {any} */ (manager.active).signer;
    } else {
      if (!userData.privateKey) throw new Error('Private key not generated yet');
      signer = new SimpleSigner(userData.privateKey);
    }
    const signed = await createDefaultMembershipForm(signer);
    await publishEvent(signed);
    eventStore.add(signed);
    return `${signed.kind}:${signed.pubkey}:membership`;
  }

  async function createCommunity() {
    try {
      isPublishing = true;

      // Determine which account to use
      let account = manager.active;
      let signer = account?.signer;

      if (!useCurrentKeypair) {
        // Create new account for the community
        if (!userData.privateKey) {
          throw new Error(m.create_community_modal_error_private_key());
        }
        signer = new SimpleSigner(userData.privateKey);
        account = new SimpleAccount(userData.publicKey, signer);

        // Add account to manager
        if (!manager.getAccountForPubkey(userData.publicKey)) {
          manager.addAccount(account);
          manager.setActive(account);
        }

        // Publish kind:0 profile event for new keypair
        const profileEvent = {
          kind: 0,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: JSON.stringify({
            name: userData.name,
            about: userData.about,
            picture: userData.picture,
            website: userData.website
          }),
          pubkey: account.pubkey
        };

        const signedProfileEvent = await signer.signEvent(profileEvent);
        const profileResult = await publishEvent(signedProfileEvent);
        if (profileResult.success) {
          eventStore.add(signedProfileEvent);
          console.log('CreateCommunityModal: Profile event published');
        }
      }

      if (!account || !signer) {
        throw new Error(m.create_community_modal_error_no_account());
      }

      // Validate at least one relay
      if (communityData.relays.length === 0) {
        throw new Error(m.create_community_modal_error_relay_required());
      }

      // Clear formRefs if access control is disabled
      if (!showAccessConfig) {
        for (const ct of Object.values(communityData.contentTypes)) {
          ct.formRef = '';
        }
      }

      // New communities always use new-spec tags (profile list a-tags)
      const communityTags = buildCommunityDefinitionTags(communityData, {
        communityPubkey: account.pubkey
      });

      const communityEvent = {
        kind: 10222,
        created_at: Math.floor(Date.now() / 1000),
        tags: communityTags,
        content: '',
        pubkey: account.pubkey
      };

      // Sign the community event
      const signedCommunityEvent = await signer.signEvent(communityEvent);

      // Publish community event (kind 10222) - uses communikey relays
      const communityResult = await publishEvent(signedCommunityEvent);
      if (communityResult.success) {
        eventStore.add(signedCommunityEvent);
      }

      // Create kind 30000 profile list events for gated sections
      for (const [, ct] of Object.entries(communityData.contentTypes)) {
        if (!ct.enabled || !ct.formRef) continue;

        const profileListEvent = {
          kind: 30000,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['d', ct.name],
            ['form', ct.formRef]
          ],
          content: '',
          pubkey: account.pubkey
        };

        const signedProfileList = await signer.signEvent(profileListEvent);
        const plResult = await publishEvent(signedProfileList);
        if (plResult.success) {
          eventStore.add(signedProfileList);
        }
      }

      // Join the community using follow set (kind 30000)
      const { joinCommunity } = await import('$lib/helpers/community');
      const joinResult = await joinCommunity(account.pubkey);

      if (communityResult.success || joinResult.success) {
        console.log('CreateCommunityModal: Successfully created community');
        isPublishing = false;

        // Navigate to the newly created community
        const npub = hexToNpub(account.pubkey);
        if (npub) {
          closeModal();
          goto(resolve(`/c/${npub}`));
        } else {
          console.error('Failed to convert pubkey to npub');
          closeModal();
        }
      } else {
        throw new Error(m.create_community_modal_error_publish_failed());
      }
    } catch (error) {
      console.error('Error creating community:', error);
      errors.publishing =
        error instanceof Error ? error.message : m.create_community_modal_error_failed();
      isPublishing = false;
    }
  }

  function closeModal() {
    // Prevent closing during publishing
    if (isPublishing) return;
    modalStore.closeModal();
    // Reset state
    currentStep = 0;
    useCurrentKeypair = false;
    userData = {
      name: '',
      about: '',
      picture: '',
      website: '',
      privateKey: /** @type {Uint8Array | null} */ (null),
      publicKey: '',
      nsec: '',
      npub: '',
      downloadConfirmed: false,
      ncryptsecPassword: '',
      useEncryption: false
    };
    communityData = {
      relays: ['wss://relay.edufeed.org'],
      blossomServers: ['blossom.edufeed.org'],
      location: '',
      description: '',
      contentTypes: {
        calendar: {
          name: 'Calendar',
          enabled: true,
          badges: { read: null, write: null },
          relays: [],
          formRef: ''
        },
        chat: {
          name: 'Chat',
          enabled: true,
          badges: { read: null, write: null },
          relays: [],
          formRef: ''
        },
        articles: {
          name: 'Articles',
          enabled: true,
          badges: { read: null, write: null },
          relays: [],
          formRef: ''
        },
        posts: {
          name: 'Forum',
          enabled: true,
          badges: { read: null, write: null },
          relays: [],
          formRef: ''
        },
        wikis: {
          name: 'Wikis',
          enabled: true,
          badges: { read: null, write: null },
          relays: [],
          formRef: ''
        }
      }
    };
    showAccessConfig = false;
    defaultFormRef = '';
    errors = {};
  }
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box max-w-2xl">
    <!-- Header with steps -->
    <div class="mb-6">
      <h1 class="mb-4 text-2xl font-bold">{m.create_community_modal_title()}</h1>

      <!-- Step indicator - only show after keypair selection -->
      {#if currentStep > 0}
        <ul class="steps w-full">
          {#each getStepLabels() as label, index (index)}
            <li class="step {displayStep > index ? 'step-primary' : ''}">{label}</li>
          {/each}
        </ul>
      {/if}
    </div>

    <!-- Step content -->
    <div class="min-h-96">
      {#if currentStep === 0}
        <!-- Keypair Selection Step -->
        <div class="space-y-4">
          <h2 class="mb-4 text-xl font-semibold">
            {m.create_community_modal_keypair_selection_title()}
          </h2>

          <div class="space-y-4">
            <!-- Use Current Keypair Option -->
            <div class="card bg-base-200">
              <div class="card-body">
                <h3 class="card-title">{m.create_community_modal_current_keypair_title()}</h3>
                <p class="text-sm opacity-70">
                  {m.create_community_modal_current_keypair_description()}
                </p>
                <div class="mt-4 card-actions justify-end">
                  <button class="btn btn-primary" onclick={selectCurrentKeypair}>
                    {m.create_community_modal_current_keypair_button()}
                  </button>
                </div>
              </div>
            </div>

            <!-- Create New Keypair Option -->
            <div class="card bg-base-200">
              <div class="card-body">
                <h3 class="card-title">{m.create_community_modal_new_keypair_title()}</h3>
                <p class="text-sm opacity-70">
                  {m.create_community_modal_new_keypair_description()}
                </p>
                <div class="mt-4 card-actions justify-end">
                  <button class="btn btn-secondary" onclick={selectNewKeypair}>
                    {m.create_community_modal_new_keypair_button()}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      {:else if currentStep === 1 && useCurrentKeypair}
        <!-- Community Settings for Current Keypair -->
        <div class="space-y-6">
          <div class="prose mb-4 max-w-none">
            <p class="text-sm text-base-content/70">
              {m.create_community_modal_current_settings_info()}
            </p>
          </div>

          <!-- Location -->
          <LocationInput
            bind:value={communityData.location}
            label={m.create_community_modal_location_label()}
            placeholder={m.create_community_modal_location_placeholder()}
          />

          <!-- Community Description -->
          <div class="form-control">
            <label class="label" for="ccm-current-description-textarea">
              <span class="label-text">{m.create_community_modal_description_label()}</span>
              <span class="label-text-alt">{m.create_community_modal_description_alt()}</span>
            </label>
            <textarea
              id="ccm-current-description-textarea"
              bind:value={communityData.description}
              placeholder={m.create_community_modal_description_placeholder()}
              class="textarea-bordered textarea h-24 w-full"
            ></textarea>
          </div>

          <!-- Content Types & Access Control -->
          <ContentTypesAndACL
            bind:contentTypes={communityData.contentTypes}
            formTemplates={getFormTemplates()}
            bind:showAccessConfig
            bind:defaultFormRef
            onCreateDefaultForm={handleCreateDefaultForm}
            {errors}
          />

          <!-- Advanced Settings -->
          <div class="collapse-arrow collapse bg-base-200">
            <input type="checkbox" />
            <div class="collapse-title font-medium">
              {m.advanced_settings_label?.() || 'Advanced Settings'}
            </div>
            <div class="collapse-content space-y-4">
              <EditableList
                bind:items={communityData.relays}
                label={m.create_community_modal_relays_label()}
                placeholder={m.create_community_modal_relays_placeholder()}
                buttonText={m.create_community_modal_relays_button()}
                itemType="relay"
                validator={validateRelayUrl}
                minItems={1}
                helpText={m.create_community_modal_relays_help()}
              />
              <EditableList
                bind:items={communityData.blossomServers}
                label={m.create_community_modal_blossom_label()}
                placeholder={m.create_community_modal_blossom_placeholder()}
                buttonText={m.create_community_modal_blossom_button()}
                itemType="server"
              />
            </div>
          </div>
        </div>
      {:else if currentStep === 2 && useCurrentKeypair}
        <!-- Confirmation for Current Keypair -->
        <div class="space-y-6">
          <h2 class="mb-4 text-xl font-semibold">{m.create_community_modal_confirm_title()}</h2>

          <div class="space-y-4">
            <!-- Profile Info -->
            <div class="card bg-base-200">
              <div class="card-body">
                <h3 class="card-title">{m.create_community_modal_confirm_profile_current()}</h3>
                <p class="text-sm text-base-content/70">
                  {m.create_community_modal_confirm_profile_current_info()}
                </p>
                <p>
                  <strong>{m.create_community_modal_confirm_pubkey()}</strong>
                  <code class="text-xs">{manager.active?.pubkey.slice(0, 16)}...</code>
                </p>
              </div>
            </div>

            <!-- Community Settings -->
            <div class="card bg-base-200">
              <div class="card-body">
                <h3 class="card-title">{m.create_community_modal_confirm_settings_section()}</h3>
                <div class="space-y-2 text-sm">
                  <p>
                    <strong>{m.create_community_modal_confirm_relays()}</strong>
                    {communityData.relays.join(', ')}
                  </p>
                  {#if communityData.blossomServers.length > 0}
                    <p>
                      <strong>{m.create_community_modal_confirm_blossom()}</strong>
                      {communityData.blossomServers.join(', ')}
                    </p>
                  {/if}
                  {#if communityData.location}
                    <p>
                      <strong>{m.create_community_modal_confirm_location()}</strong>
                      {communityData.location}
                    </p>
                  {/if}
                  {#if communityData.description}
                    <p>
                      <strong>{m.create_community_modal_confirm_description()}</strong>
                      {communityData.description}
                    </p>
                  {/if}
                </div>
              </div>
            </div>

            <!-- Content Types -->
            <div class="card bg-base-200">
              <div class="card-body">
                <h3 class="card-title">
                  {m.create_community_modal_confirm_content_types_section()}
                </h3>
                <div class="flex flex-wrap gap-2">
                  {#each Object.entries(communityData.contentTypes) as [key, ct] (key)}
                    {#if ct.enabled}
                      <div class="badge gap-1 badge-primary">
                        {ct.name}
                        {#if ct.formRef}
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            class="h-3 w-3"
                          >
                            <path
                              fill-rule="evenodd"
                              d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
                              clip-rule="evenodd"
                            />
                          </svg>
                        {/if}
                      </div>
                    {/if}
                  {/each}
                </div>
                {#if Object.values(communityData.contentTypes).some((ct) => ct.enabled && ct.formRef)}
                  <div class="mt-2 space-y-1 text-sm text-base-content/70">
                    {#each Object.entries(communityData.contentTypes) as [_key, ct] (_key)}
                      {#if ct.enabled && ct.formRef}
                        <p>
                          {ct.name}: {m.form_config_gated_summary({
                            formName: getFormName(ct.formRef)
                          })}
                        </p>
                      {/if}
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          </div>
        </div>
      {:else if currentStep === 1 && !useCurrentKeypair}
        <!-- Profile Creation for New Keypair -->
        <div class="space-y-6">
          <div class="prose max-w-none">
            <h2 class="mb-4 text-xl font-semibold">
              {m.create_community_modal_profile_title({ name: userData.name || 'Your Community' })}
            </h2>
            <p class="mb-4">
              {m.create_community_modal_profile_description()}
            </p>
          </div>

          <ImageUploader {userData} {errors} />

          <ProfileForm {userData} {errors} />
        </div>
      {:else if currentStep === 2 && !useCurrentKeypair}
        <!-- Keys Generation for New Keypair -->
        <KeypairGenerator {userData} {errors} />
      {:else if currentStep === 3 && !useCurrentKeypair}
        <!-- Community Settings for New Keypair -->
        <div class="space-y-6">
          <h2 class="mb-4 text-xl font-semibold">
            {m.create_community_modal_step_community_settings()}
          </h2>

          <!-- Location -->
          <LocationInput
            bind:value={communityData.location}
            label={m.create_community_modal_location_label()}
            placeholder={m.create_community_modal_location_placeholder()}
          />

          <!-- Community Description -->
          <div class="form-control">
            <label class="label" for="ccm-new-description-textarea">
              <span class="label-text">{m.create_community_modal_description_label()}</span>
              <span class="label-text-alt">{m.create_community_modal_description_alt()}</span>
            </label>
            <textarea
              id="ccm-new-description-textarea"
              bind:value={communityData.description}
              placeholder={m.create_community_modal_description_placeholder()}
              class="textarea-bordered textarea h-24 w-full"
            ></textarea>
          </div>

          <!-- Content Types & Access Control -->
          <ContentTypesAndACL
            bind:contentTypes={communityData.contentTypes}
            formTemplates={getFormTemplates()}
            bind:showAccessConfig
            bind:defaultFormRef
            onCreateDefaultForm={handleCreateDefaultForm}
            {errors}
          />

          <!-- Advanced Settings -->
          <div class="collapse-arrow collapse bg-base-200">
            <input type="checkbox" />
            <div class="collapse-title font-medium">
              {m.advanced_settings_label?.() || 'Advanced Settings'}
            </div>
            <div class="collapse-content space-y-4">
              <EditableList
                bind:items={communityData.relays}
                label={m.create_community_modal_relays_label()}
                placeholder={m.create_community_modal_relays_placeholder()}
                buttonText={m.create_community_modal_relays_button()}
                itemType="relay"
                validator={validateRelayUrl}
                minItems={1}
                helpText={m.create_community_modal_relays_help()}
              />
              <EditableList
                bind:items={communityData.blossomServers}
                label={m.create_community_modal_blossom_label()}
                placeholder={m.create_community_modal_blossom_placeholder()}
                buttonText={m.create_community_modal_blossom_button()}
                itemType="server"
              />
            </div>
          </div>
        </div>
      {:else if currentStep === 4 && !useCurrentKeypair}
        <!-- Confirmation for New Keypair -->
        <div class="space-y-6">
          <h2 class="mb-4 text-xl font-semibold">{m.create_community_modal_confirm_title()}</h2>

          <div class="space-y-4">
            <!-- Profile Info -->
            <div class="card bg-base-200">
              <div class="card-body">
                <h3 class="card-title">{m.create_community_modal_confirm_profile_section()}</h3>
                <div class="space-y-2">
                  <p><strong>{m.create_community_modal_confirm_name()}</strong> {userData.name}</p>
                  <p>
                    <strong>{m.create_community_modal_confirm_about()}</strong>
                    {userData.about || m.create_community_modal_confirm_about_none()}
                  </p>
                  <p>
                    <strong>{m.create_community_modal_confirm_pubkey()}</strong>
                    <code class="text-xs">{userData.npub.slice(0, 16)}...</code>
                  </p>
                </div>
              </div>
            </div>

            <!-- Community Settings -->
            <div class="card bg-base-200">
              <div class="card-body">
                <h3 class="card-title">{m.create_community_modal_confirm_settings_section()}</h3>
                <div class="space-y-2 text-sm">
                  <p>
                    <strong>{m.create_community_modal_confirm_relays()}</strong>
                    {communityData.relays.join(', ')}
                  </p>
                  {#if communityData.blossomServers.length > 0}
                    <p>
                      <strong>{m.create_community_modal_confirm_blossom()}</strong>
                      {communityData.blossomServers.join(', ')}
                    </p>
                  {/if}
                  {#if communityData.location}
                    <p>
                      <strong>{m.create_community_modal_confirm_location()}</strong>
                      {communityData.location}
                    </p>
                  {/if}
                  {#if communityData.description}
                    <p>
                      <strong>{m.create_community_modal_confirm_description()}</strong>
                      {communityData.description}
                    </p>
                  {/if}
                </div>
              </div>
            </div>

            <!-- Content Types -->
            <div class="card bg-base-200">
              <div class="card-body">
                <h3 class="card-title">
                  {m.create_community_modal_confirm_content_types_section()}
                </h3>
                <div class="flex flex-wrap gap-2">
                  {#each Object.entries(communityData.contentTypes) as [key, ct] (key)}
                    {#if ct.enabled}
                      <div class="badge gap-1 badge-primary">
                        {ct.name}
                        {#if ct.formRef}
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            class="h-3 w-3"
                          >
                            <path
                              fill-rule="evenodd"
                              d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
                              clip-rule="evenodd"
                            />
                          </svg>
                        {/if}
                      </div>
                    {/if}
                  {/each}
                </div>
                {#if Object.values(communityData.contentTypes).some((ct) => ct.enabled && ct.formRef)}
                  <div class="mt-2 space-y-1 text-sm text-base-content/70">
                    {#each Object.entries(communityData.contentTypes) as [_key, ct] (_key)}
                      {#if ct.enabled && ct.formRef}
                        <p>
                          {ct.name}: {m.form_config_gated_summary({
                            formName: getFormName(ct.formRef)
                          })}
                        </p>
                      {/if}
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          </div>
        </div>
      {:else}
        <!-- Fallback -->
        <div class="alert alert-error">
          <span>{m.create_community_modal_error_invalid_state()}</span>
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
              {m.create_community_modal_button_back()}
            </button>
          {/if}
        </div>

        <div class="flex gap-2">
          <form method="dialog">
            <button class="btn">{m.create_community_modal_button_cancel()}</button>
          </form>

          {#if currentStep > 0}
            {#if currentStep < totalSteps}
              <button class="btn btn-primary" onclick={nextStep}>
                {m.create_community_modal_button_next()}
                <ChevronRightIcon />
              </button>
            {:else}
              <button class="btn btn-primary" onclick={createCommunity} disabled={isPublishing}>
                {#if isPublishing}
                  <span class="loading loading-sm loading-spinner"></span>
                  {m.create_community_modal_button_creating()}
                {:else}
                  {m.create_community_modal_button_create()}
                {/if}
              </button>
            {/if}
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
