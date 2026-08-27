<!--
  CommunityBasicsForm — the inline home of everything EditCommunityModal used
  to hold (settings redesign, laoc 2026-08-18): community profile entry,
  location, content types, LiveKit, and the advanced relay/blossom lists,
  saving the rebuilt 10222 with the community signer.

  The description is NOT here: it lives once, in the kind-0 profile
  (getCommunityAbout) — the inline 10222 `description` override this card used
  to offer was read by nothing the user could see (laoc, 2026-08-21).

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
  import { plainTemplate } from '$lib/helpers/plain-template.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { showToast } from '$lib/helpers/toast';
  import EditableList from '$lib/components/shared/EditableList.svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
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
  import { deriveCommunityType, parseMembershipPointer } from '$lib/groups/community-membership.js';
  import { syncRootGroupMetadataWithFallback } from '$lib/groups/sync-group-metadata.js';
  import { flatGroupsRelay, communityGroupsEndpoint } from '$lib/groups/community-endpoint.js';
  import { manager } from '$lib/stores/accounts.svelte.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { addressLoader } from '$lib/loaders/base.js';

  let { communikeyEvent } = $props();

  // The community's kind-0 — previewed in the profile row so the card shows
  // the name/picture/description it sends you to the modal to edit.
  const getCommunityProfile = useUserProfile(() => communikeyEvent?.pubkey);
  let communityProfile = $derived(getCommunityProfile());

  let communityData = $state({
    relays: /** @type {string[]} */ ([]),
    blossomServers: /** @type {string[]} */ ([]),
    location: '',
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
  // The community's own relay address: the per-community virtual endpoint
  // wss://<host>/c/<rootId>, whose NIP-11 carries this community's name,
  // about and icon — that is what other clients (Armada) open it with. The
  // membership pointer stores the FLAT host instead, because creates and
  // moderation writes must land there (see community-endpoint.js), so it is
  // shown as the host, not as the address.
  let membershipPointer = $derived(parseMembershipPointer(communikeyEvent));
  // Trailing slash trimmed: normalizeURL adds one, which reads as a typo next
  // to the slash-free endpoint shown above it.
  let groupRelayHost = $derived(
    membershipPointer ? flatGroupsRelay(membershipPointer.relay).replace(/\/$/, '') : ''
  );
  let groupRelay = $derived(
    membershipPointer ? communityGroupsEndpoint(membershipPointer.relay, membershipPointer.id) : ''
  );

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
      // De-proxy before signing: template.tags reuse communikeyEvent's Svelte
      // $state proxy entries, which structuredClone (the extension signer's
      // postMessage boundary) can't clone — DataCloneError otherwise.
      const signedEvent = await signer.signEvent(plainTemplate(template));
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
          publishEventOptimistic(await signer.signEvent(plainTemplate(profileListEvent)));
        }
      }

      showToast(m.community_basics_saved(), 'success');

      // Refresh the linked NIP-29 group's 39000 from the community's CURRENT
      // kind-0. Nothing on this card edits those fields anymore, so this is a
      // no-op in the common case — but it makes "Änderungen speichern" the
      // repair action for a group whose metadata went stale, instead of that
      // living only behind the profile modal (laoc, 2026-08-21). Best-effort:
      // the 10222 is already published, so a refusal only warns.
      const syncResult = await syncRootGroupMetadataWithFallback({
        pointer: parseMembershipPointer(communikeyEvent),
        profile: {
          name: communityProfile?.name,
          about: communityProfile?.about,
          picture: communityProfile?.picture
        },
        // Community signer first, human admin as backup — see the helper.
        signers: [{ pubkey: communikeyEvent.pubkey, signer }, manager.active]
      });
      if (!syncResult.ok) showToast(m.community_group_metadata_sync_failed(), 'warning');
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
      signer: communitySigner,
      // Task A7: lets EditProfileModal re-issue a 9002 for the community's
      // linked NIP-29 root group (if any) after this profile save succeeds.
      communikeyEvent
    });
  }
</script>

<div class="card mb-6 bg-base-100 shadow-xl" data-testid="community-basics-form">
  <div class="card-body space-y-5">
    <!-- Community profile (kind 0): avatar, banner, name, description.
      Previews what it owns — since the inline description override went away
      this row is the single place those fields are edited. -->
    <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-base-200 p-4">
      <div class="flex min-w-0 items-center gap-3">
        <ProfileAvatar profile={communityProfile} size="sm" />
        <div class="min-w-0">
          <h2 class="truncate font-medium">
            {communityProfile?.name ||
              m.edit_community_modal_profile_section_title?.() ||
              'Community profile'}
          </h2>
          <p class="line-clamp-2 text-xs text-base-content/60">
            {communityProfile?.about ||
              m.edit_community_modal_profile_section_note?.() ||
              'Avatar, banner, name, and other kind 0 metadata.'}
          </p>
        </div>
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
        <!-- The NIP-29 relay holding the roster + channels. Read-only on
          purpose: a group cannot move relays, only be founded anew there. -->
        {#if groupRelay}
          <div class="form-control" data-testid="basics-group-relay">
            <div class="label">
              <span class="label-text">{m.community_basics_group_relay_label()}</span>
            </div>
            <code
              class="block truncate rounded-lg bg-base-100 px-3 py-2 font-mono text-sm text-base-content/80"
              >{groupRelay}</code
            >
            <!-- Plain <p>, not label-text-alt: the .label flex row keeps a
              sentence this long on one line and clips it at the card edge. -->
            <p class="mt-1 text-xs text-base-content/60">
              {m.community_basics_group_relay_help({ host: groupRelayHost })}
            </p>
          </div>
        {/if}
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
