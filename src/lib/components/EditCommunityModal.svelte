<script>
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { publishEventOptimistic } from '$lib/services/publish-service.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import EditableList from './shared/EditableList.svelte';
  import LocationInput from './shared/LocationInput.svelte';
  import ContentTypesAndACL from './shared/ContentTypesAndACL.svelte';
  import { deriveDefaultFormRef } from '$lib/helpers/communityFormDefaults.js';
  import { buildCommunityDefinitionTags } from '$lib/helpers/communityTagBuilder.js';
  import { useFormTemplates } from '$lib/stores/form-templates.svelte.js';
  import { parseCommunityContentTypes } from '$lib/helpers/communityRelays.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { addressLoader } from '$lib/loaders/base.js';
  import { createDefaultMembershipForm } from '$lib/helpers/forms.js';
  import { publishEvent } from '$lib/services/publish-service.js';

  let { modalId } = $props();

  // Get community event from modal props
  let communityEvent = $derived(/** @type {any} */ (modalStore.modalProps)?.communityEvent);

  // Community data state - initialized from communityEvent
  let communityData = $state({
    relays: /** @type {string[]} */ ([]),
    blossomServers: /** @type {string[]} */ ([]),
    location: '',
    description: '',
    contentTypes: {
      calendar: {
        name: 'Calendar',
        enabled: false,
        badges: { read: null, write: null },
        relays: [],
        formRef: ''
      },
      chat: {
        name: 'Chat',
        enabled: false,
        badges: { read: null, write: null },
        relays: [],
        formRef: ''
      },
      articles: {
        name: 'Articles',
        enabled: false,
        badges: { read: null, write: null },
        relays: [],
        formRef: ''
      },
      posts: {
        name: 'Forum',
        enabled: false,
        badges: { read: null, write: null },
        relays: [],
        formRef: ''
      },
      wikis: {
        name: 'Wikis',
        enabled: false,
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
    const communityPk = communityEvent?.pubkey;
    const userPk = manager.active?.pubkey;
    /** @type {string[]} */
    const authors = communityPk ? [communityPk] : [];
    if (userPk && userPk !== communityPk) authors.push(userPk);
    return authors;
  });

  // UI state
  let isPublishing = $state(false);
  let errors = $state(/** @type {Record<string, string>} */ ({}));
  let isInitialized = $state(false);

  // Kind to content type key mapping
  /** @type {Record<number, string>} */
  const kindToKey = {
    31922: 'calendar',
    31923: 'calendar',
    9: 'chat',
    30023: 'articles',
    1: 'posts',
    11: 'posts',
    30818: 'wikis'
  };

  // Initialize from community event when it changes
  $effect(() => {
    if (!communityEvent || isInitialized) return;

    const tags = communityEvent.tags || [];

    // Parse global relays (r tags without 'content' marker)
    const relays = tags
      .filter((/** @type {string[]} */ t) => t[0] === 'r' && t[2] !== 'content')
      .map((/** @type {string[]} */ t) => t[1]);

    // Parse blossom servers
    const blossomServers = tags
      .filter((/** @type {string[]} */ t) => t[0] === 'blossom')
      .map((/** @type {string[]} */ t) => t[1]);

    // Parse location
    const locationTag = tags.find((/** @type {string[]} */ t) => t[0] === 'location');
    const location = locationTag ? locationTag[1] : '';

    // Parse description
    const descriptionTag = tags.find((/** @type {string[]} */ t) => t[0] === 'description');
    const description = descriptionTag ? descriptionTag[1] : '';

    // Parse content types with badges, relays, and formRef
    const contentTypes = {
      calendar: {
        name: 'Calendar',
        enabled: false,
        badges: { read: null, write: null },
        relays: [],
        formRef: ''
      },
      chat: {
        name: 'Chat',
        enabled: false,
        badges: { read: null, write: null },
        relays: [],
        formRef: ''
      },
      articles: {
        name: 'Articles',
        enabled: false,
        badges: { read: null, write: null },
        relays: [],
        formRef: ''
      },
      posts: {
        name: 'Forum',
        enabled: false,
        badges: { read: null, write: null },
        relays: [],
        formRef: ''
      },
      wikis: {
        name: 'Wikis',
        enabled: false,
        badges: { read: null, write: null },
        relays: [],
        formRef: ''
      }
    };

    // Parse content sections from tags
    /** @type {string|null} */
    let currentSection = null;

    for (const tag of tags) {
      if (!Array.isArray(tag) || tag.length === 0) continue;

      if (tag[0] === 'content') {
        // Start new section
        currentSection = tag[1]?.toLowerCase() || null;
      } else if (tag[0] === 'k' && currentSection) {
        // Kind tag - enable corresponding content type
        const kind = parseInt(tag[1], 10);
        const key = kindToKey[kind];
        if (key && contentTypes[key]) {
          contentTypes[key].enabled = true;
        }
      } else if (tag[0] === 'a' && currentSection && tag[1]?.startsWith('30009:')) {
        // Badge tag
        const key =
          currentSection === 'calendar'
            ? 'calendar'
            : currentSection === 'chat'
              ? 'chat'
              : currentSection === 'articles'
                ? 'articles'
                : currentSection === 'posts'
                  ? 'posts'
                  : currentSection === 'wikis'
                    ? 'wikis'
                    : null;

        if (key && contentTypes[key]) {
          const qualifier = tag[2] || 'write';
          if (qualifier === 'read') {
            contentTypes[key].badges.read = tag[1];
          } else {
            contentTypes[key].badges.write = tag[1];
          }
        }
      }
    }

    communityData = {
      relays: relays.length > 0 ? relays : ['wss://relay.edufeed.org'],
      blossomServers,
      location,
      description,
      contentTypes
    };

    isInitialized = true;

    // Load existing form refs from profile list events
    loadFormRefs(communityEvent);
  });

  /**
   * Load form refs from existing kind 30000 profile list events
   * @param {any} commEvent
   */
  function loadFormRefs(commEvent) {
    const sections = parseCommunityContentTypes(commEvent);
    const gatedSections = sections.filter((s) => s.profileList);

    if (gatedSections.length > 0) {
      showAccessConfig = true;
    }

    for (const section of gatedSections) {
      if (!section.profileList) continue;

      const parts = section.profileList.split(':');
      if (parts.length < 3) continue;

      const [, pubkey, ...identifierParts] = parts;
      const identifier = identifierParts.join(':');

      addressLoader({
        kind: 30000,
        pubkey,
        identifier,
        relays: getCommunikeyRelays()
      }).subscribe();

      eventStore.replaceable(30000, pubkey, identifier).subscribe((event) => {
        if (!event) return;
        const formTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'form');
        if (!formTag?.[1]) return;

        // Map section name back to content type key
        const key = Object.keys(communityData.contentTypes).find(
          (k) => communityData.contentTypes[k].name.toLowerCase() === section.name.toLowerCase()
        );
        if (key) {
          communityData.contentTypes[key].formRef = formTag[1];
        }
      });
    }
  }

  // Derive defaultFormRef once formRefs load from network
  let defaultDerived = $state(false);
  $effect(() => {
    const anyGated = Object.values(communityData.contentTypes).some(
      (ct) => ct.enabled && ct.formRef
    );
    if (anyGated && !defaultDerived) {
      defaultDerived = true;
      defaultFormRef = deriveDefaultFormRef(communityData.contentTypes);
      showAccessConfig = true;
    }
  });

  // Reset when modal closes
  $effect(() => {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (!dialog) return;

    const handleDialogClose = () => {
      if (modalStore.activeModal === 'editCommunity') {
        modalStore.closeModal();
        resetState();
      }
    };

    dialog.addEventListener('close', handleDialogClose);
    return () => {
      dialog.removeEventListener('close', handleDialogClose);
    };
  });

  function resetState() {
    communityData = {
      relays: [],
      blossomServers: [],
      location: '',
      description: '',
      contentTypes: {
        calendar: {
          name: 'Calendar',
          enabled: false,
          badges: { read: null, write: null },
          relays: [],
          formRef: ''
        },
        chat: {
          name: 'Chat',
          enabled: false,
          badges: { read: null, write: null },
          relays: [],
          formRef: ''
        },
        articles: {
          name: 'Articles',
          enabled: false,
          badges: { read: null, write: null },
          relays: [],
          formRef: ''
        },
        posts: {
          name: 'Forum',
          enabled: false,
          badges: { read: null, write: null },
          relays: [],
          formRef: ''
        },
        wikis: {
          name: 'Wikis',
          enabled: false,
          badges: { read: null, write: null },
          relays: [],
          formRef: ''
        }
      }
    };
    showAccessConfig = false;
    defaultFormRef = '';
    defaultDerived = false;
    isPublishing = false;
    errors = {};
    isInitialized = false;
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

  async function handleCreateDefaultForm() {
    const signed = await createDefaultMembershipForm(manager.active.signer);
    await publishEvent(signed);
    eventStore.add(signed);
    return `${signed.kind}:${signed.pubkey}:membership`;
  }

  function validate() {
    errors = {};

    if (communityData.relays.length === 0) {
      errors.relays = m.create_community_modal_error_relays_required();
      return false;
    }

    const hasContentType = Object.values(communityData.contentTypes).some((ct) => ct.enabled);
    if (!hasContentType) {
      errors.contentTypes = m.create_community_modal_error_content_types_required();
      return false;
    }

    return true;
  }

  async function saveCommunity() {
    if (!validate()) return;

    try {
      isPublishing = true;

      const account = manager.active;

      if (!account) {
        throw new Error(m.create_community_modal_error_no_account());
      }

      // Verify ownership
      if (communityEvent?.pubkey !== account.pubkey) {
        throw new Error(
          m.edit_community_modal_error_not_owner?.() || 'Only the community owner can edit settings'
        );
      }

      // Clear formRefs if access control is disabled
      if (!showAccessConfig) {
        for (const ct of Object.values(communityData.contentTypes)) {
          ct.formRef = '';
        }
      }

      // Detect old-spec: community has badge a-tags → preserve old format
      const hasBadges = Object.values(communityData.contentTypes).some(
        (ct) => ct.badges.read || ct.badges.write
      );
      const communityTags = buildCommunityDefinitionTags(
        communityData,
        hasBadges ? {} : { communityPubkey: communityEvent.pubkey }
      );

      /** @type {import('nostr-tools').EventTemplate} */
      const communityUpdateEvent = {
        kind: 10222,
        created_at: Math.floor(Date.now() / 1000),
        tags: communityTags,
        content: ''
      };

      const signedEvent = await account.signEvent(communityUpdateEvent);
      publishEventOptimistic(signedEvent);

      // Create/update kind 30000 profile list events for gated sections
      for (const [, ct] of Object.entries(communityData.contentTypes)) {
        if (!ct.enabled || !ct.formRef) continue;

        /** @type {import('nostr-tools').EventTemplate} */
        const profileListEvent = {
          kind: 30000,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['d', ct.name],
            ['form', ct.formRef]
          ],
          content: ''
        };

        const signedProfileList = await account.signEvent(profileListEvent);
        publishEventOptimistic(signedProfileList);
      }

      closeModal();
    } catch (error) {
      console.error('Error updating community:', error);
      errors.publishing =
        error instanceof Error ? error.message : m.create_community_modal_error_failed();
    } finally {
      isPublishing = false;
    }
  }

  function closeModal() {
    modalStore.closeModal();
    resetState();
  }

  // Check if current user is the owner
  let isOwner = $derived(
    communityEvent?.pubkey &&
      manager.active?.pubkey &&
      communityEvent.pubkey === manager.active.pubkey
  );
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box max-w-2xl">
    <h1 class="mb-6 text-2xl font-bold">
      {m.edit_community_modal_title?.() || 'Edit Community Settings'}
    </h1>

    {#if !communityEvent}
      <div class="alert alert-error">
        <span>{m.edit_community_modal_error_no_community?.() || 'No community data available'}</span
        >
      </div>
    {:else if !isOwner}
      <div class="alert alert-warning">
        <span
          >{m.edit_community_modal_error_not_owner?.() ||
            'Only the community owner can edit settings'}</span
        >
      </div>
    {:else}
      <div class="space-y-6">
        <!-- Location -->
        <LocationInput
          bind:value={communityData.location}
          label={m.create_community_modal_location_label()}
          placeholder={m.create_community_modal_location_placeholder()}
        />

        <!-- Community Description -->
        <div class="form-control">
          <label class="label" for="ecm-description-textarea">
            <span class="label-text">{m.create_community_modal_description_label()}</span>
            <span class="label-text-alt">{m.create_community_modal_description_alt()}</span>
          </label>
          <textarea
            id="ecm-description-textarea"
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
        <!-- Actions -->
        <div class="modal-action">
          <div class="flex w-full justify-between">
            <div></div>
            <div class="flex gap-2">
              <form method="dialog">
                <button class="btn">{m.create_community_modal_button_cancel()}</button>
              </form>

              <button class="btn btn-primary" onclick={saveCommunity} disabled={isPublishing}>
                {#if isPublishing}
                  <span class="loading loading-sm loading-spinner"></span>
                  {m.edit_community_modal_button_saving?.() || 'Saving...'}
                {:else}
                  {m.edit_community_modal_button_save?.() || 'Save Changes'}
                {/if}
              </button>

              {#if errors.publishing}
                <div class="mt-4 alert alert-error">
                  <span>{errors.publishing}</span>
                </div>
              {/if}
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>
</dialog>
