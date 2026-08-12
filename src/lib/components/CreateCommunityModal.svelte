<script>
  import * as m from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { manager } from '$lib/stores/accounts.svelte';
  import { SimpleSigner } from 'applesauce-signers';
  import { SimpleAccount } from 'applesauce-accounts/accounts';
  import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { hexToNpub } from '$lib/helpers/nostrUtils.js';
  import ChevronLeftIcon from './icons/ui/ChevronLeftIcon.svelte';
  import ChevronRightIcon from './icons/ui/ChevronRightIcon.svelte';
  import KeypairGenerator from './shared/KeypairGenerator.svelte';
  import LicensedImageInput from './shared/LicensedImageInput.svelte';
  import BannerUploader from './shared/BannerUploader.svelte';
  import ProfileForm from './shared/ProfileForm.svelte';
  import EditableList from './shared/EditableList.svelte';
  import LocationInput from './shared/LocationInput.svelte';
  import ContentTypesAndACL from './shared/ContentTypesAndACL.svelte';
  import {
    buildCommunityDefinitionTags,
    createDefaultContentTypes
  } from '$lib/helpers/communityTagBuilder.js';
  import { getCommunityGlobalRelays } from '$lib/helpers/communityRelays.js';
  import { useFormTemplates } from '$lib/stores/form-templates.svelte.js';
  import { parseFormTemplate, createDefaultMembershipForm } from '$lib/helpers/forms.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  // Concord submodules imported DIRECTLY (never the barrel) — the convention
  // every Concord call site follows (see CLAUDE.md's Concord section).
  import { getConcordClient } from '$lib/concord/client.svelte.js';
  import { withConcordPointer } from '$lib/concord/pointer.js';
  import {
    readFoundingMarker,
    writeFoundingMarker,
    clearFoundingMarker
  } from '$lib/concord/founding.js';
  import {
    communityWizardSteps,
    applyDefaultAccess,
    disableAllContentTypes
  } from '$lib/components/community/create/wizard-logic.js';
  import { moderatedCreationAvailable } from '$lib/groups/feature.js';
  import {
    provisionRootGroup,
    readRootGroupMarker,
    writeRootGroupMarker,
    clearRootGroupMarker
  } from '$lib/groups/provision-root-group.js';
  import { getGroupsRelays } from '$lib/helpers/relay-helper.js';

  let { modalId } = $props();

  // Step management - improved flow
  let currentStep = $state(0); // 0 = keypair selection, 1+ = actual steps
  let useCurrentKeypair = $state(false);

  // Community type, chosen on the wizard's 'type' step (design spec
  // 2026-08-12). Replaces the old private-area toggle — 'closed' now implies
  // the Concord private area, minted FIRST below for the same reason the old
  // toggle did: the Concord client belongs to the HUMAN's active account,
  // and the area owner must be the human, not the community keypair.
  /** @type {'open' | 'moderated' | 'closed'} */
  let communityType = $state('open');
  /** @type {'all' | 'members'} */
  let defaultAccessTier = $state('members');
  const moderatedAvailable = $derived(moderatedCreationAvailable());
  const closedAvailable = $derived(!!runtimeConfig.concord?.enabled);
  const typeStepVisible = $derived(moderatedAvailable || closedAvailable);
  const wizardSteps = $derived(communityWizardSteps({ useCurrentKeypair, typeStepVisible }));
  /** @returns {string | null} id of the current step, null on the keypair screen */
  const currentStepId = $derived(currentStep > 0 ? (wizardSteps[currentStep - 1] ?? null) : null);

  // Dynamic step count based on choice (after keypair selection) - list-driven
  let totalSteps = $derived(currentStep === 0 ? 0 : wizardSteps.length);

  // Current step display (adjusted for stepper)
  let displayStep = $derived.by(() => {
    if (currentStep === 0) return 0;
    return useCurrentKeypair ? currentStep : currentStep - 1; // New keypair starts from step 1 after profile
  });

  // Licensed community picture: informational flags the licensed input binds
  // (the license event is published by the input's own modal).
  let communityImageUploaded = $state(false);
  let communityImageLicense = $state(null);

  // User data state for new keypair creation
  let userData = $state({
    name: '',
    about: '',
    picture: '',
    banner: '',
    website: '',
    privateKey: /** @type {Uint8Array | null} */ (null),
    publicKey: '',
    nsec: '',
    npub: '',
    downloadConfirmed: false,
    ncryptsecPassword: '',
    useEncryption: false
  });

  /**
   * Signer used for the community's uploads + kind 1063 license attestations
   * (avatar, banner). Derived so the avatar/banner widgets always see the
   * right signer regardless of which keypair flow the user picked.
   *
   *   - useCurrentKeypair: use the active user's own signer
   *   - new keypair:       SimpleSigner around the freshly-generated privateKey
   */
  const communitySigner = $derived.by(() => {
    if (useCurrentKeypair) return manager.active?.signer ?? null;
    if (userData.privateKey) {
      try {
        return new SimpleSigner(userData.privateKey);
      } catch (e) {
        console.error('CreateCommunityModal: failed to build community signer:', e);
        return null;
      }
    }
    return null;
  });

  // Generate the community keypair as soon as the user picks "new keypair" so
  // the AvatarUploader/BannerUploader in Step 1 have a working signer for
  // Blossom uploads + kind 1063 license attestations. KeypairGenerator at
  // Step 2 just displays the already-generated keys.
  $effect(() => {
    if (!useCurrentKeypair && currentStep > 0 && !userData.privateKey) {
      try {
        const privateKey = generateSecretKey();
        const publicKey = getPublicKey(privateKey);
        userData.privateKey = privateKey;
        userData.publicKey = publicKey;
        userData.nsec = nip19.nsecEncode(privateKey);
        userData.npub = nip19.npubEncode(publicKey);
      } catch (e) {
        console.error('Community keypair generation failed:', e);
      }
    }
  });

  // Content types enabled by default for new communities (Meet stays off
  // because it needs a LiveKit operator URL)
  const DEFAULT_ENABLED_CONTENT_TYPES = [
    'calendar',
    'chat',
    'articles',
    'posts',
    'wikis',
    'learning',
    'polls',
    'bookmarks'
  ];

  // Community data state
  let communityData = $state({
    relays: ['wss://relay.edufeed.org'],
    blossomServers: ['blossom.edufeed.org'],
    location: '',
    description: '',
    livekitUrl: '',
    contentTypes: createDefaultContentTypes(DEFAULT_ENABLED_CONTENT_TYPES)
  });

  // Content types as they'll actually be published, given the chosen
  // community type — single source of truth for BOTH the confirm-step
  // summary and createCommunity(), so they can never disagree (code review
  // finding, 2026-08-12):
  //   open      → unchanged
  //   moderated → default access tier applied to every entry, and formRef
  //               forced empty (moderated access comes from the group
  //               roster, never the legacy per-type form-gating profile
  //               list — a stale formRef here would otherwise still make
  //               buildCommunityDefinitionTags emit a dangling
  //               ['a', '30000:...'] pointer to a profile list the
  //               kind-30000 loop below never creates for moderated types)
  //   closed    → every entry disabled (closed communities publish no
  //               sections at all)
  const effectiveContentTypes = $derived.by(() => {
    if (communityType === 'moderated') {
      const withAccess = applyDefaultAccess(communityData.contentTypes, defaultAccessTier);
      return Object.fromEntries(
        Object.entries(withAccess).map(([key, ct]) => [key, { ...ct, formRef: '' }])
      );
    }
    if (communityType === 'closed') {
      return disableAllContentTypes(communityData.contentTypes);
    }
    return communityData.contentTypes;
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
        modalStore.closeModal();
        // Reset state on close
        currentStep = 0;
        useCurrentKeypair = false;
        userData = {
          name: '',
          about: '',
          picture: '',
          banner: '',
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
          livekitUrl: '',
          contentTypes: createDefaultContentTypes(DEFAULT_ENABLED_CONTENT_TYPES)
        };
        showAccessConfig = false;
        defaultFormRef = '';
        communityType = 'open';
        defaultAccessTier = 'members';
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
    const stepId = wizardSteps[step - 1];

    if (stepId === 'profile') {
      if (!userData.name.trim()) {
        errors.name = m.create_community_modal_error_name_required();
        return false;
      }
    }

    if (stepId === 'keys') {
      if (!userData.downloadConfirmed) {
        errors.download = m.create_community_modal_error_download_required();
        return false;
      }
    }

    if (stepId === 'settings') {
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

      if (communityData.contentTypes.meet?.enabled && !communityData.livekitUrl?.trim()) {
        errors.livekitUrl = m.meet_livekit_url_required();
        return false;
      }
    }

    // 'type' and 'confirm' steps have no validation.
    return true;
  }

  // Get step labels based on the wizard step list
  function getStepLabels() {
    return wizardSteps.map((id) => {
      switch (id) {
        case 'profile':
          return m.create_community_modal_step_profile();
        case 'keys':
          return m.create_community_modal_step_keys();
        case 'type':
          return m.create_community_modal_step_type();
        case 'settings':
          return m.create_community_modal_step_community_settings();
        case 'confirm':
          return m.create_community_modal_step_confirm();
        default:
          return id;
      }
    });
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

    const maxSteps = wizardSteps.length;
    if (currentStep < maxSteps) {
      currentStep++;
    }
  }

  function prevStep() {
    if (currentStep > 1) {
      currentStep--;
    }
  }

  /**
   * Pick the community type on the 'type' step. Belt-and-suspenders on top
   * of `effectiveContentTypes` stripping formRef for moderated/closed: also
   * collapse the legacy form-gating ACL section so its UI doesn't imply
   * settings that won't be published (code review finding, 2026-08-12).
   * @param {'open' | 'moderated' | 'closed'} type
   */
  function selectCommunityType(type) {
    communityType = type;
    if (type !== 'open') {
      showAccessConfig = false;
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

      // Mint the Concord area BEFORE any account juggling: the client is the
      // human's, so the human becomes the area owner (spec §3.1) — and in the
      // new-keypair flow `manager.setActive` below would race the concord
      // service's async client swap. Founding-marker idempotency mirrors
      // foundConcordArea: a retry after a failed publish reuses the already-
      // minted area instead of orphaning a duplicate.
      /** @type {string | undefined} */
      let concordAreaId;
      if (communityType === 'closed' && runtimeConfig.concord?.enabled) {
        const client = getConcordClient();
        if (!client) throw new Error(m.concord_not_ready());
        const communityPk = useCurrentKeypair ? manager.active?.pubkey : userData.publicKey;
        const pendingId = communityPk ? readFoundingMarker(communityPk) : undefined;
        if (pendingId && client.getCommunity(pendingId)) {
          concordAreaId = pendingId;
        } else {
          const areaName =
            (!useCurrentKeypair && userData.name.trim()) || m.concord_default_area_name();
          const area = await client.createNewCommunity(areaName, '', runtimeConfig.concord.relays);
          const mintedId = /** @type {string} */ (area.communityId);
          concordAreaId = mintedId;
          if (communityPk) writeFoundingMarker(communityPk, mintedId);
        }
      }

      // Moderated communities need a NIP-29 ROOT group whose roster/roles ARE
      // the membership — minted with the HUMAN's own signer, same reasoning
      // (and BEFORE the account switch below) as the Concord area above.
      // Marker idempotency mirrors the Concord founding marker.
      /** @type {{id: string, relay: string} | null} */
      let rootGroupPointer = null;
      if (communityType === 'moderated') {
        const groupsRelay = getGroupsRelays()[0];
        const communityPk = useCurrentKeypair ? manager.active?.pubkey : userData.publicKey;
        const activeAccount = manager.active;
        if (!activeAccount || !communityPk) {
          throw new Error(m.create_community_modal_error_no_account());
        }
        try {
          rootGroupPointer = await provisionRootGroup({
            relay: groupsRelay,
            name: userData.name?.trim() || 'Community',
            user: { pubkey: activeAccount.pubkey, signer: activeAccount.signer },
            existingId: readRootGroupMarker(communityPk)
          });
          writeRootGroupMarker(communityPk, rootGroupPointer.id);
        } catch (err) {
          errors.publishing = m.community_type_provisioning_error({
            reason: err instanceof Error ? err.message : String(err)
          });
          isPublishing = false;
          return;
        }
      }

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
            banner: userData.banner,
            website: userData.website
          }),
          pubkey: account.pubkey
        };

        const signedProfileEvent = await signer.signEvent(profileEvent);
        const profileResult = await publishEvent(signedProfileEvent);
        if (profileResult.success) {
          eventStore.add(signedProfileEvent);
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

      // New communities always use new-spec tags (profile list a-tags).
      // effectiveContentTypes ($derived above) is the single source of truth
      // for what gets published per community type — the confirm-step
      // summary renders from the same value.
      let communityTags = buildCommunityDefinitionTags(
        { ...communityData, contentTypes: effectiveContentTypes },
        {
          communityPubkey: account.pubkey,
          membership: rootGroupPointer ?? undefined
        }
      );
      if (concordAreaId) {
        communityTags = withConcordPointer(
          communityTags,
          concordAreaId,
          runtimeConfig.concord?.relays?.[0]
        );
      }

      const communityEvent = {
        kind: 10222,
        created_at: Math.floor(Date.now() / 1000),
        tags: communityTags,
        content: '',
        pubkey: account.pubkey
      };

      // Sign the community event
      const signedCommunityEvent = await signer.signEvent(communityEvent);

      // Publish community event (kind 10222) - uses communikey relays + community's own relays
      const communityResult = await publishEvent(signedCommunityEvent, [], {
        additionalRelays: getCommunityGlobalRelays(signedCommunityEvent)
      });
      if (communityResult.success) {
        eventStore.add(signedCommunityEvent);
        if (concordAreaId) clearFoundingMarker(account.pubkey);
        if (rootGroupPointer) clearRootGroupMarker(account.pubkey);
      }

      // Create kind 30000 profile list events for gated sections. Moderated
      // communities gate access via the group roster instead — this legacy
      // per-content-type form-gating path only applies to open communities.
      if (communityType === 'open') {
        for (const [, ct] of Object.entries(effectiveContentTypes)) {
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
      }

      // Join the community using follow set (kind 30000)
      const { joinCommunity } = await import('$lib/helpers/community');
      const joinResult = await joinCommunity(account.pubkey);

      if (communityResult.success || joinResult.success) {
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
      banner: '',
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
      livekitUrl: '',
      contentTypes: createDefaultContentTypes(DEFAULT_ENABLED_CONTENT_TYPES)
    };
    showAccessConfig = false;
    defaultFormRef = '';
    communityType = 'open';
    defaultAccessTier = 'members';
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
      {:else if currentStepId === 'profile'}
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

          <!-- The community picture goes through the licensed image input
               (upload + paste + license attestation), replacing the old raw
               uploader/URL pair (laoc, 2026-08-11). -->
          <div class="form-control flex flex-col">
            <span class="label-text mb-1 w-full text-center">{m.profile_form_picture_label()}</span>
            <LicensedImageInput
              bind:imageUrl={userData.picture}
              bind:imageWasUploaded={communityImageUploaded}
              bind:licenseEvent={communityImageLicense}
              {errors}
              activeUserDisplayName={userData.name}
            />
          </div>
          <BannerUploader bind:userData signer={communitySigner} bind:errors />

          <ProfileForm {userData} {errors} hideBanner={true} hidePicture={true} />
        </div>
      {:else if currentStepId === 'keys'}
        <!-- Keys Generation for New Keypair -->
        <KeypairGenerator {userData} {errors} />
      {:else if currentStepId === 'type'}
        <!-- Community Type -->
        <div class="space-y-4">
          <h3 class="text-lg font-semibold">{m.community_type_question()}</h3>
          <div
            class="grid gap-3 sm:grid-cols-{1 +
              (moderatedAvailable ? 1 : 0) +
              (closedAvailable ? 1 : 0)}"
          >
            <button
              type="button"
              class="card border p-4 text-left {communityType === 'open'
                ? 'border-primary bg-primary/5'
                : 'border-base-300'}"
              data-testid="community-type-open"
              onclick={() => selectCommunityType('open')}
            >
              <span class="text-2xl">🌍</span>
              <strong>{m.community_type_open_title()}</strong>
              <p class="text-sm">{m.community_type_open_body()}</p>
              <p class="text-xs text-base-content/60">{m.community_type_open_hint()}</p>
            </button>
            {#if moderatedAvailable}
              <button
                type="button"
                class="card border p-4 text-left {communityType === 'moderated'
                  ? 'border-primary bg-primary/5'
                  : 'border-base-300'}"
                data-testid="community-type-moderated"
                onclick={() => selectCommunityType('moderated')}
              >
                <span class="text-2xl">🛡️</span>
                <strong
                  >{m.community_type_moderated_title()}
                  <span class="badge badge-sm badge-primary">{m.community_type_recommended()}</span
                  ></strong
                >
                <p class="text-sm">{m.community_type_moderated_body()}</p>
                <p class="text-xs text-base-content/60">{m.community_type_moderated_hint()}</p>
              </button>
            {/if}
            {#if closedAvailable}
              <button
                type="button"
                class="card border p-4 text-left {communityType === 'closed'
                  ? 'border-primary bg-primary/5'
                  : 'border-base-300'}"
                data-testid="community-type-closed"
                onclick={() => selectCommunityType('closed')}
              >
                <span class="text-2xl">🔒</span>
                <strong>{m.community_type_closed_title()}</strong>
                <p class="text-sm">{m.community_type_closed_body()}</p>
                <p class="text-xs text-base-content/60">{m.community_type_closed_hint()}</p>
              </button>
            {/if}
          </div>
        </div>
      {:else if currentStepId === 'settings'}
        <!-- Community Settings -->
        <div class="space-y-6">
          {#if useCurrentKeypair}
            <div class="prose mb-4 max-w-none">
              <p class="text-sm text-base-content/70">
                {m.create_community_modal_current_settings_info()}
              </p>
            </div>
          {:else}
            <h2 class="mb-4 text-xl font-semibold">
              {m.create_community_modal_step_community_settings()}
            </h2>
          {/if}

          <!-- Location -->
          <LocationInput
            bind:value={communityData.location}
            label={m.create_community_modal_location_label()}
            placeholder={m.create_community_modal_location_placeholder()}
          />

          <!-- Community Description -->
          <div class="form-control">
            <label class="label" for="ccm-description-textarea">
              <span class="label-text">{m.create_community_modal_description_label()}</span>
              <span class="label-text-alt">{m.create_community_modal_description_alt()}</span>
            </label>
            <textarea
              id="ccm-description-textarea"
              bind:value={communityData.description}
              placeholder={m.create_community_modal_description_placeholder()}
              class="textarea-bordered textarea h-24 w-full"
            ></textarea>
          </div>

          <!-- Content Types & Access Control (closed communities publish no
               sections — Concord channels replace them) -->
          {#if communityType !== 'closed'}
            <ContentTypesAndACL
              bind:contentTypes={communityData.contentTypes}
              formTemplates={getFormTemplates()}
              bind:showAccessConfig
              bind:defaultFormRef
              onCreateDefaultForm={handleCreateDefaultForm}
              hideAccessToggle={communityType === 'moderated'}
              {errors}
            />
          {/if}

          {#if communityType === 'moderated'}
            <fieldset class="space-y-2" data-testid="community-access-question">
              <legend class="font-medium">{m.community_access_question()}</legend>
              <label class="flex items-start gap-2">
                <input
                  type="radio"
                  class="radio mt-1 radio-sm"
                  bind:group={defaultAccessTier}
                  value="members"
                />
                <span
                  >{m.community_access_members()}<br /><span class="text-xs text-base-content/60"
                    >{m.community_access_members_hint()}</span
                  ></span
                >
              </label>
              <label class="flex items-start gap-2">
                <input
                  type="radio"
                  class="radio mt-1 radio-sm"
                  bind:group={defaultAccessTier}
                  value="all"
                />
                <span
                  >{m.community_access_all()}<br /><span class="text-xs text-base-content/60"
                    >{m.community_access_all_hint()}</span
                  ></span
                >
              </label>
            </fieldset>
          {/if}

          <!-- LiveKit URL (shown when Meet is enabled) -->
          {#if communityData.contentTypes.meet?.enabled}
            <div class="form-control">
              <label class="label" for="ccm-livekit-url">
                <span class="label-text">{m.meet_livekit_url()}</span>
              </label>
              <input
                id="ccm-livekit-url"
                type="url"
                class="input-bordered input"
                placeholder={m.meet_livekit_url_placeholder()}
                bind:value={communityData.livekitUrl}
              />
              <div class="label">
                <span class="label-text-alt">{m.meet_livekit_url_help()}</span>
              </div>
              {#if errors.livekitUrl}
                <p class="mt-1 text-sm text-error">{errors.livekitUrl}</p>
              {/if}
            </div>
          {/if}

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
      {:else if currentStepId === 'confirm'}
        <!-- Confirmation -->
        <div class="space-y-6">
          <h2 class="mb-4 text-xl font-semibold">{m.create_community_modal_confirm_title()}</h2>

          <div class="space-y-4">
            <!-- Profile Info -->
            <div class="card bg-base-200">
              <div class="card-body">
                {#if useCurrentKeypair}
                  <h3 class="card-title">{m.create_community_modal_confirm_profile_current()}</h3>
                  <p class="text-sm text-base-content/70">
                    {m.create_community_modal_confirm_profile_current_info()}
                  </p>
                  <p>
                    <strong>{m.create_community_modal_confirm_pubkey()}</strong>
                    <code class="text-xs">{manager.active?.pubkey.slice(0, 16)}...</code>
                  </p>
                {:else}
                  <h3 class="card-title">{m.create_community_modal_confirm_profile_section()}</h3>
                  <div class="space-y-2">
                    <p>
                      <strong>{m.create_community_modal_confirm_name()}</strong>
                      {userData.name}
                    </p>
                    <p>
                      <strong>{m.create_community_modal_confirm_about()}</strong>
                      {userData.about || m.create_community_modal_confirm_about_none()}
                    </p>
                    <p>
                      <strong>{m.create_community_modal_confirm_pubkey()}</strong>
                      <code class="text-xs">{userData.npub.slice(0, 16)}...</code>
                    </p>
                  </div>
                {/if}
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

            <!-- Content Types (rendered from effectiveContentTypes, the same
                 value createCommunity() publishes from — see its $derived
                 above; closed communities publish no sections at all) -->
            <div class="card bg-base-200">
              <div class="card-body">
                <h3 class="card-title">
                  {m.create_community_modal_confirm_content_types_section()}
                </h3>
                {#if communityType === 'closed'}
                  <p class="text-sm text-base-content/70">
                    {m.community_type_closed_confirm_note()}
                  </p>
                {:else}
                  <div class="flex flex-wrap gap-2">
                    {#each Object.entries(effectiveContentTypes) as [key, ct] (key)}
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
                  {#if communityType === 'moderated'}
                    <p class="mt-2 text-sm">
                      <strong>{m.community_access_question()}</strong>
                      {defaultAccessTier === 'members'
                        ? m.community_access_members()
                        : m.community_access_all()}
                    </p>
                  {/if}
                  {#if Object.values(effectiveContentTypes).some((ct) => ct.enabled && ct.formRef)}
                    <div class="mt-2 space-y-1 text-sm text-base-content/70">
                      {#each Object.entries(effectiveContentTypes) as [_key, ct] (_key)}
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
