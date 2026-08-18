<!--
  CommunityBasicsForm — the inline home of everything EditCommunityModal used
  to hold (settings redesign, laoc 2026-08-18): community profile entry,
  location, description, content types, LiveKit, and the advanced
  relay/blossom lists, saving the rebuilt 10222 with the community signer.

  Being a PAGE section (not a modal) also dissolves the old modal-in-modal
  problem: opening the kind-0 profile editor no longer unmounts this form,
  so the window.confirm() guard the modal needed is gone.

  Save semantics ported verbatim from the modal: pointer tags preserved,
  legacy badge format detected, access tiers round-tripped, per-section
  profile lists only for non-moderated legacy communities.
-->
<script>
  import * as m from '$lib/paraglide/messages';
  import { getCommunitySigner } from '$lib/helpers/community-signer.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { publishEventOptimistic } from '$lib/services/publish-service.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { showToast } from '$lib/helpers/toast';
  import EditableList from '$lib/components/shared/EditableList.svelte';
  import LocationInput from '$lib/components/shared/LocationInput.svelte';
  import ContentTypesAndACL from '$lib/components/shared/ContentTypesAndACL.svelte';
  import {
    buildCommunityDefinitionTags,
    createDefaultContentTypes,
    preservePointerTags,
    applyParsedAccessTiers
  } from '$lib/helpers/communityTagBuilder.js';
  import {
    parseCommunityContentTypes,
    parseCommunityMetadata,
    getCommunityGlobalRelays,
    hasStrictContentMarker
  } from '$lib/helpers/communityRelays.js';
  import { deriveCommunityType } from '$lib/groups/community-membership.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { addressLoader } from '$lib/loaders/base.js';

  let { communikeyEvent } = $props();

  let communityData = $state({
    relays: /** @type {string[]} */ ([]),
    blossomServers: /** @type {string[]} */ ([]),
    location: '',
    description: '',
    livekitUrl: '',
    contentTypes: createDefaultContentTypes()
  });

  // Moderated communities gate access via the group roster, not the legacy
  // per-content-type form-gating profile list.
  let isModerated = $derived(deriveCommunityType(communikeyEvent) === 'moderated');
  // A CLOSED community's sections are its Schaufenster (publisher-gated by
  // the window picker) — the chips are hidden and save() carries the event's
  // section tags over verbatim. Rebuilding them here would emit UNGATED
  // sections and silently flip the community to Offen.
  let isClosed = $derived(deriveCommunityType(communikeyEvent) === 'closed');

  let isPublishing = $state(false);
  let errors = $state(/** @type {Record<string, string>} */ ({}));
  let initializedForId = /** @type {string | null} */ (null);

  /** @type {Record<number, string>} */
  const kindToKey = {
    31922: 'calendar',
    31923: 'calendar',
    31924: 'calendar',
    31925: 'calendar',
    9: 'chat',
    30023: 'articles',
    1: 'posts',
    11: 'posts',
    30818: 'wikis',
    30142: 'learning',
    1068: 'polls',
    39701: 'bookmarks',
    9802: 'bookmarks',
    30312: 'meet',
    30313: 'meet'
  };

  // Initialize from the event; re-initialize when a NEW 10222 replaces it
  // (e.g. a type flip elsewhere on the page) so the form never edits stale
  // tags — the modal only ever initialized once per open.
  $effect(() => {
    if (!communikeyEvent || initializedForId === communikeyEvent.id) return;
    initializedForId = communikeyEvent.id;

    const tags = communikeyEvent.tags || [];
    const relays = tags
      .filter((/** @type {string[]} */ t) => t[0] === 'r' && t[2] !== 'content')
      .map((/** @type {string[]} */ t) => t[1]);
    const blossomServers = tags
      .filter((/** @type {string[]} */ t) => t[0] === 'blossom')
      .map((/** @type {string[]} */ t) => t[1]);
    const location = tags.find((/** @type {string[]} */ t) => t[0] === 'location')?.[1] ?? '';
    const description = tags.find((/** @type {string[]} */ t) => t[0] === 'description')?.[1] ?? '';
    const contentTypes = createDefaultContentTypes();
    const metadata = parseCommunityMetadata(communikeyEvent);
    const livekitUrl = metadata.livekitUrl || '';

    /** @type {string|null} */
    let currentSection = null;
    /** @type {string|null} */
    let currentSectionOriginalName = null;
    for (const tag of tags) {
      if (!Array.isArray(tag) || tag.length === 0) continue;
      if (tag[0] === 'content') {
        currentSection = tag[1]?.toLowerCase() || null;
        currentSectionOriginalName = tag[1] || null;
      } else if (tag[0] === 'k' && currentSection) {
        const key = kindToKey[parseInt(tag[1], 10)];
        if (key && contentTypes[key]) {
          contentTypes[key].enabled = true;
          if (currentSectionOriginalName) contentTypes[key].name = currentSectionOriginalName;
        }
      } else if (tag[0] === 'a' && currentSection && tag[1]?.startsWith('30009:')) {
        const key = ['calendar', 'chat', 'articles', 'posts', 'wikis'].includes(currentSection)
          ? currentSection
          : null;
        if (key && contentTypes[key]) {
          if ((tag[2] || 'write') === 'read') contentTypes[key].badges.read = tag[1];
          else contentTypes[key].badges.write = tag[1];
        }
      }
    }

    // Legacy definitions (no strict marker) fail open — pre-enable everything
    // so saving preserves the status quo. Meet only when a LiveKit URL exists.
    if (!hasStrictContentMarker(communikeyEvent)) {
      for (const [key, ct] of Object.entries(contentTypes)) {
        if (key === 'meet' && !livekitUrl && !ct.enabled) continue;
        ct.enabled = true;
      }
    }

    communityData = {
      relays: relays.length > 0 ? relays : ['wss://relay.edufeed.org'],
      blossomServers,
      location,
      description,
      livekitUrl,
      contentTypes: applyParsedAccessTiers(contentTypes, communikeyEvent)
    };

    // Legacy form refs round-trip only for non-moderated communities (the
    // roster gates moderated ones) — see the modal-era comments in git.
    if (!isModerated) loadFormRefs(communikeyEvent);
  });

  /** @param {any} commEvent */
  function loadFormRefs(commEvent) {
    const sections = parseCommunityContentTypes(commEvent).filter((s) => s.profileList);
    for (const section of sections) {
      if (!section.profileList) continue;
      const parts = section.profileList.split(':');
      if (parts.length < 3) continue;
      const [, pubkey, ...identifierParts] = parts;
      const identifier = identifierParts.join(':');
      addressLoader({ kind: 30000, pubkey, identifier, relays: getCommunikeyRelays() }).subscribe();
      eventStore.replaceable(30000, pubkey, identifier).subscribe((event) => {
        if (!event) return;
        const formRef = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'form')?.[1];
        if (!formRef) return;
        const key = Object.keys(communityData.contentTypes).find(
          (k) => communityData.contentTypes[k].name.toLowerCase() === section.name.toLowerCase()
        );
        if (key) communityData.contentTypes[key].formRef = formRef;
      });
    }
  }

  const communitySigner = $derived.by(() => getCommunitySigner(communikeyEvent?.pubkey));

  /** @param {string} url */
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
    if (isClosed) return true; // sections are the window picker's business
    if (!Object.values(communityData.contentTypes).some((ct) => ct.enabled)) {
      errors.contentTypes = m.create_community_modal_error_content_types_required();
      return false;
    }
    if (communityData.contentTypes.meet?.enabled && !communityData.livekitUrl?.trim()) {
      errors.livekitUrl = m.meet_livekit_url_required();
      return false;
    }
    return true;
  }

  /**
   * The event's content-section tags, verbatim: everything from the first
   * `content` tag on (sections are positional — see communityRelays' parser).
   * @param {string[][]} tags
   */
  function originalSectionTags(tags) {
    const first = (tags ?? []).findIndex((t) => Array.isArray(t) && t[0] === 'content');
    return first === -1 ? [] : tags.slice(first);
  }

  async function save() {
    if (!validate() || isPublishing) return;
    try {
      isPublishing = true;
      const signer = communitySigner;
      if (!signer || !communikeyEvent?.pubkey) {
        throw new Error(
          m.edit_community_modal_error_not_owner?.() || 'Only the community owner can edit settings'
        );
      }

      const hasBadges = Object.values(communityData.contentTypes).some(
        (ct) => ct.badges.read || ct.badges.write
      );
      // Closed: rebuild only the top-level fields (sections disabled so the
      // builder emits none), then re-append the event's own gated sections.
      const buildData = isClosed
        ? {
            ...communityData,
            contentTypes: Object.fromEntries(
              Object.entries(communityData.contentTypes).map(([key, ct]) => [
                key,
                { ...ct, enabled: false }
              ])
            )
          }
        : communityData;
      const rebuiltTags = buildCommunityDefinitionTags(
        buildData,
        hasBadges ? {} : { communityPubkey: communikeyEvent.pubkey }
      );
      const communityTags = [
        ...preservePointerTags(communikeyEvent.tags, rebuiltTags),
        ...(isClosed ? originalSectionTags(communikeyEvent.tags ?? []) : [])
      ];

      /** @type {import('nostr-tools').EventTemplate} */
      const template = {
        kind: 10222,
        created_at: Math.floor(Date.now() / 1000),
        tags: communityTags,
        content: ''
      };
      const signedEvent = await signer.signEvent(template);
      publishEventOptimistic(signedEvent, [], {
        additionalRelays: getCommunityGlobalRelays(signedEvent)
      });

      // Legacy per-section profile lists (non-moderated only, and only where
      // a formRef already round-tripped in — see loadFormRefs).
      if (!isModerated) {
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
          publishEventOptimistic(await signer.signEvent(profileListEvent));
        }
      }

      showToast(m.community_basics_saved(), 'success');
    } catch (error) {
      console.error('Error updating community:', error);
      errors.publishing =
        error instanceof Error ? error.message : m.create_community_modal_error_failed();
    } finally {
      isPublishing = false;
    }
  }

  // Opens the standard profile editor in community mode: same UI as the
  // user's own profile, signed by the community keypair. No unsaved-changes
  // confirm needed anymore — this form lives on the page and survives the
  // modal opening.
  function openCommunityProfileEdit() {
    if (!communikeyEvent?.pubkey || !communitySigner) return;
    const existing = /** @type {any} */ (eventStore.getReplaceable(0, communikeyEvent.pubkey));
    let profile = {};
    if (existing?.content) {
      try {
        profile = JSON.parse(existing.content);
      } catch {
        /* ignore parse errors — start with empty form */
      }
    }
    modalStore.openModal('profile', {
      profile,
      pubkey: communikeyEvent.pubkey,
      signer: communitySigner
    });
  }
</script>

<div class="card mb-6 bg-base-100 shadow-xl" data-testid="community-basics-form">
  <div class="card-body space-y-5">
    <!-- Community profile (kind 0): avatar, banner, name … -->
    <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-base-200 p-4">
      <div>
        <h2 class="font-medium">
          {m.edit_community_modal_profile_section_title?.() || 'Community profile'}
        </h2>
        <p class="text-xs text-base-content/60">
          {m.edit_community_modal_profile_section_note?.() ||
            'Avatar, banner, name, and other kind 0 metadata.'}
        </p>
      </div>
      <button
        type="button"
        class="btn btn-sm btn-primary"
        data-testid="basics-edit-profile"
        onclick={openCommunityProfileEdit}
      >
        {m.edit_community_modal_profile_section_button?.() || 'Edit community profile'}
      </button>
    </div>

    <div class="form-control">
      <label class="label" for="basics-description">
        <span class="label-text">{m.create_community_modal_description_label()}</span>
        <span class="label-text-alt">{m.create_community_modal_description_alt()}</span>
      </label>
      <textarea
        id="basics-description"
        bind:value={communityData.description}
        placeholder={m.create_community_modal_description_placeholder()}
        class="textarea-bordered textarea h-24 w-full"
      ></textarea>
    </div>

    <LocationInput
      bind:value={communityData.location}
      label={m.create_community_modal_location_label()}
      placeholder={m.create_community_modal_location_placeholder()}
    />

    {#if !isClosed}
      <ContentTypesAndACL bind:contentTypes={communityData.contentTypes} {errors} />
    {:else}
      <p class="rounded-lg bg-base-200 p-3 text-xs text-base-content/60">
        {m.community_basics_closed_sections_hint()}
      </p>
    {/if}

    {#if !isClosed && communityData.contentTypes.meet?.enabled}
      <div class="form-control">
        <label class="label" for="basics-livekit-url">
          <span class="label-text">{m.meet_livekit_url()}</span>
        </label>
        <input
          id="basics-livekit-url"
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

    <div class="flex items-center justify-end gap-3">
      {#if errors.publishing}
        <p class="text-sm text-error">{errors.publishing}</p>
      {/if}
      <button
        class="btn btn-primary"
        data-testid="basics-save"
        onclick={save}
        disabled={isPublishing}
      >
        {#if isPublishing}
          <span class="loading loading-sm loading-spinner"></span>
          {m.edit_community_modal_button_saving?.() || 'Saving...'}
        {:else}
          {m.edit_community_modal_button_save?.() || 'Save Changes'}
        {/if}
      </button>
    </div>
  </div>
</div>
