<script>
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import EditableList from './shared/EditableList.svelte';
  import LocationInput from './shared/LocationInput.svelte';
  import ContentTypeFormConfig from './shared/ContentTypeFormConfig.svelte';
  import { buildCommunityDefinitionTags } from '$lib/helpers/communityTagBuilder.js';
  import { formTemplateLoader } from '$lib/loaders/community.js';
  import { parseCommunityContentTypes } from '$lib/helpers/communityRelays.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { addressLoader } from '$lib/loaders/base.js';
  import { TimelineModel } from 'applesauce-core/models';

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
        name: 'Posts',
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
  let showAdvancedRelays = $state(false);

  // Form templates for access gating
  /** @type {any[]} */
  let formTemplates = $state.raw([]);

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
        name: 'Posts',
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
      } else if (tag[0] === 'r' && currentSection && tag[2] === 'content') {
        // Per-content-type relay
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
          contentTypes[key].relays.push(tag[1]);
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

  // Load form templates for the community
  $effect(() => {
    const pubkey = communityEvent?.pubkey;
    if (!pubkey) return;

    /** @type {import('rxjs').Subscription | undefined} */
    let loaderSub;
    /** @type {import('rxjs').Subscription | undefined} */
    let modelSub;

    loaderSub = formTemplateLoader(pubkey)().subscribe();
    modelSub = eventStore
      .model(TimelineModel, { kinds: [30168], authors: [pubkey] })
      .subscribe((events) => {
        formTemplates = events || [];
      });

    return () => {
      loaderSub?.unsubscribe();
      modelSub?.unsubscribe();
    };
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
          name: 'Posts',
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
    showAdvancedRelays = false;
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
      const signer = account?.signer;

      if (!account || !signer) {
        throw new Error(m.create_community_modal_error_no_account());
      }

      // Verify ownership
      if (communityEvent?.pubkey !== account.pubkey) {
        throw new Error(
          m.edit_community_modal_error_not_owner?.() || 'Only the community owner can edit settings'
        );
      }

      // Detect old-spec: community has badge a-tags → preserve old format
      const hasBadges = Object.values(communityData.contentTypes).some(
        (ct) => ct.badges.read || ct.badges.write
      );
      const communityTags = buildCommunityDefinitionTags(
        communityData,
        hasBadges ? {} : { communityPubkey: communityEvent.pubkey }
      );

      const communityUpdateEvent = {
        kind: 10222,
        created_at: Math.floor(Date.now() / 1000),
        tags: communityTags,
        content: '',
        pubkey: account.pubkey
      };

      const signedEvent = await signer.signEvent(communityUpdateEvent);

      // Publish using outbox model + communikey relays (for kind 10222)
      const publishResult = await publishEvent(signedEvent);

      if (publishResult.success) {
        eventStore.add(signedEvent);

        // Create/update kind 30000 profile list events for gated sections
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

        console.log('EditCommunityModal: Successfully updated community');
        closeModal();
      } else {
        throw new Error(m.create_community_modal_error_publish_failed());
      }
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
        <!-- Relays -->
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

        <!-- Blossom Servers -->
        <EditableList
          bind:items={communityData.blossomServers}
          label={m.create_community_modal_blossom_label()}
          placeholder={m.create_community_modal_blossom_placeholder()}
          buttonText={m.create_community_modal_blossom_button()}
          itemType="server"
        />

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
            class="textarea-bordered textarea h-24"
          ></textarea>
        </div>

        <!-- Content Types -->
        <div class="form-control">
          <div class="label">
            <span class="label-text font-semibold"
              >{m.create_community_modal_content_types_label()}</span
            >
            <span class="label-text-alt text-sm"
              >{m.create_community_modal_content_types_alt()}</span
            >
          </div>
          <div class="grid grid-cols-2 gap-3">
            <!-- Calendar Card -->
            <button
              type="button"
              class="card cursor-pointer bg-base-200 transition-all hover:bg-base-300 {communityData
                .contentTypes.calendar.enabled
                ? 'ring-2 ring-primary'
                : ''}"
              onclick={() =>
                (communityData.contentTypes.calendar.enabled =
                  !communityData.contentTypes.calendar.enabled)}
            >
              <div class="card-body p-4">
                <div class="flex items-center justify-between">
                  <span class="font-medium">{m.create_community_modal_content_calendar()}</span>
                  <input
                    type="checkbox"
                    checked={communityData.contentTypes.calendar.enabled}
                    class="pointer-events-none checkbox checkbox-primary"
                    tabindex="-1"
                  />
                </div>
              </div>
            </button>

            <!-- Chat Card -->
            <button
              type="button"
              class="card cursor-pointer bg-base-200 transition-all hover:bg-base-300 {communityData
                .contentTypes.chat.enabled
                ? 'ring-2 ring-primary'
                : ''}"
              onclick={() =>
                (communityData.contentTypes.chat.enabled =
                  !communityData.contentTypes.chat.enabled)}
            >
              <div class="card-body p-4">
                <div class="flex items-center justify-between">
                  <span class="font-medium">{m.create_community_modal_content_chat()}</span>
                  <input
                    type="checkbox"
                    checked={communityData.contentTypes.chat.enabled}
                    class="pointer-events-none checkbox checkbox-primary"
                    tabindex="-1"
                  />
                </div>
              </div>
            </button>

            <!-- Articles Card -->
            <button
              type="button"
              class="card cursor-pointer bg-base-200 transition-all hover:bg-base-300 {communityData
                .contentTypes.articles.enabled
                ? 'ring-2 ring-primary'
                : ''}"
              onclick={() =>
                (communityData.contentTypes.articles.enabled =
                  !communityData.contentTypes.articles.enabled)}
            >
              <div class="card-body p-4">
                <div class="flex items-center justify-between">
                  <span class="font-medium">{m.create_community_modal_content_articles()}</span>
                  <input
                    type="checkbox"
                    checked={communityData.contentTypes.articles.enabled}
                    class="pointer-events-none checkbox checkbox-primary"
                    tabindex="-1"
                  />
                </div>
              </div>
            </button>

            <!-- Posts Card -->
            <button
              type="button"
              class="card cursor-pointer bg-base-200 transition-all hover:bg-base-300 {communityData
                .contentTypes.posts.enabled
                ? 'ring-2 ring-primary'
                : ''}"
              onclick={() =>
                (communityData.contentTypes.posts.enabled =
                  !communityData.contentTypes.posts.enabled)}
            >
              <div class="card-body p-4">
                <div class="flex items-center justify-between">
                  <span class="font-medium">{m.create_community_modal_content_posts()}</span>
                  <input
                    type="checkbox"
                    checked={communityData.contentTypes.posts.enabled}
                    class="pointer-events-none checkbox checkbox-primary"
                    tabindex="-1"
                  />
                </div>
              </div>
            </button>

            <!-- Wikis Card -->
            <button
              type="button"
              class="card cursor-pointer bg-base-200 transition-all hover:bg-base-300 {communityData
                .contentTypes.wikis.enabled
                ? 'ring-2 ring-primary'
                : ''}"
              onclick={() =>
                (communityData.contentTypes.wikis.enabled =
                  !communityData.contentTypes.wikis.enabled)}
            >
              <div class="card-body p-4">
                <div class="flex items-center justify-between">
                  <span class="font-medium">{m.create_community_modal_content_wikis()}</span>
                  <input
                    type="checkbox"
                    checked={communityData.contentTypes.wikis.enabled}
                    class="pointer-events-none checkbox checkbox-primary"
                    tabindex="-1"
                  />
                </div>
              </div>
            </button>
          </div>
          {#if errors.contentTypes}
            <div class="label">
              <span class="label-text-alt text-error">{errors.contentTypes}</span>
            </div>
          {/if}
        </div>

        <!-- Access Control Toggle -->
        <div class="form-control mt-4">
          <label class="label cursor-pointer justify-start gap-3">
            <input type="checkbox" class="toggle toggle-primary" bind:checked={showAccessConfig} />
            <span class="label-text">{m.form_config_toggle?.() || 'Configure access control'}</span>
          </label>
          <p class="ml-12 text-xs opacity-70">
            {m.form_config_toggle_help?.() ||
              'Require a form submission for publishing to specific content types'}
          </p>
        </div>

        <!-- Access Control Section -->
        {#if showAccessConfig}
          <div class="mt-4 space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-semibold">
                {m.form_config_title?.() || 'Access Control'}
              </h3>
              <label class="label cursor-pointer gap-2">
                <span class="label-text text-sm"
                  >{m.form_config_show_relays?.() || 'Show relay config'}</span
                >
                <input type="checkbox" class="toggle toggle-sm" bind:checked={showAdvancedRelays} />
              </label>
            </div>

            {#if communityData.contentTypes.calendar.enabled}
              <ContentTypeFormConfig
                bind:contentType={communityData.contentTypes.calendar}
                {formTemplates}
                showAdvanced={showAdvancedRelays}
              />
            {/if}

            {#if communityData.contentTypes.chat.enabled}
              <ContentTypeFormConfig
                bind:contentType={communityData.contentTypes.chat}
                {formTemplates}
                showAdvanced={showAdvancedRelays}
              />
            {/if}

            {#if communityData.contentTypes.articles.enabled}
              <ContentTypeFormConfig
                bind:contentType={communityData.contentTypes.articles}
                {formTemplates}
                showAdvanced={showAdvancedRelays}
              />
            {/if}

            {#if communityData.contentTypes.posts.enabled}
              <ContentTypeFormConfig
                bind:contentType={communityData.contentTypes.posts}
                {formTemplates}
                showAdvanced={showAdvancedRelays}
              />
            {/if}

            {#if communityData.contentTypes.wikis.enabled}
              <ContentTypeFormConfig
                bind:contentType={communityData.contentTypes.wikis}
                {formTemplates}
                showAdvanced={showAdvancedRelays}
              />
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Actions -->
    <div class="modal-action">
      <div class="flex w-full justify-between">
        <div></div>
        <div class="flex gap-2">
          <form method="dialog">
            <button class="btn">{m.create_community_modal_button_cancel()}</button>
          </form>

          {#if isOwner}
            <button class="btn btn-primary" onclick={saveCommunity} disabled={isPublishing}>
              {#if isPublishing}
                <span class="loading loading-sm loading-spinner"></span>
                {m.edit_community_modal_button_saving?.() || 'Saving...'}
              {:else}
                {m.edit_community_modal_button_save?.() || 'Save Changes'}
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
