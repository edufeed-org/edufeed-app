<!--
  CreatorInput Component
  Multi-entry form for managing creators/contributors with optional Nostr identity
-->

<script>
  import * as m from '$lib/paraglide/messages';
  import { CloseIcon, PlusIcon } from '$lib/components/icons';
  import { getProfilePicture } from 'applesauce-core/helpers';
  import { useUserProfile } from '$lib/stores/user-profile.svelte';
  import { fetchProfileData } from '$lib/helpers/profile.js';
  import { normalizeToHex } from '$lib/helpers/nostrUtils.js';
  import { normalizeOrcid } from '$lib/helpers/educational/orcid.js';
  import ContactSearchInput from '$lib/components/shared/ContactSearchInput.svelte';

  /**
   * @typedef {Object} Creator
   * @property {string} name - Creator name
   * @property {'Person' | 'Organization'} type - Creator type
   * @property {string} [pubkey] - Optional Nostr pubkey (hex)
   * @property {string} [affiliationName] - Optional affiliation name
   * @property {string} [honorificPrefix] - Optional title (Dr., Prof., etc.)
   * @property {string} [orcid] - Optional ORCID iD (canonical https URI)
   */

  /** @type {{ creators?: Creator[], label?: string, required?: boolean, helpText?: string, onchange?: (creators: Creator[]) => void }} */
  let {
    creators = $bindable([]),
    label = 'Creators',
    required = false,
    helpText = '',
    onchange = () => {}
  } = $props();

  // State for new creator form
  let showAddForm = $state(false);
  let newCreator = $state(createEmptyCreator());
  let editingIndex = $state(/** @type {number | null} */ (null));
  let isLoadingProfile = $state(false);
  let orcidInvalid = $state(false);
  let pubkeyInvalid = $state(false);

  /**
   * Create an empty creator object
   * @returns {Creator}
   */
  function createEmptyCreator() {
    return {
      name: '',
      type: 'Person',
      pubkey: '',
      affiliationName: '',
      honorificPrefix: '',
      orcid: ''
    };
  }

  /**
   * Add a new creator
   */
  function addCreator() {
    if (!newCreator.name.trim()) return;

    // Normalize ORCID to its canonical https URI; block save on invalid input
    const orcidInput = newCreator.orcid?.trim();
    const normalizedOrcid = orcidInput ? normalizeOrcid(orcidInput) : '';
    if (orcidInput && !normalizedOrcid) {
      orcidInvalid = true;
      return;
    }

    // Normalize the Nostr identity to a hex pubkey; block save on anything
    // that doesn't normalize (nsec, typos) so no secret/garbage gets published
    const pubkeyInput = newCreator.pubkey?.trim();
    const normalizedPubkey = pubkeyInput ? normalizeToHex(pubkeyInput) : '';
    pubkeyInvalid = Boolean(pubkeyInput && !normalizedPubkey);
    if (pubkeyInvalid) return;

    /** @type {Creator} */
    const creatorToAdd = {
      ...newCreator,
      pubkey: normalizedPubkey || '',
      orcid: normalizedOrcid || ''
    };
    // Clean up empty optional fields
    if (!creatorToAdd.pubkey?.trim()) delete creatorToAdd.pubkey;
    if (!creatorToAdd.affiliationName?.trim()) delete creatorToAdd.affiliationName;
    if (!creatorToAdd.honorificPrefix?.trim()) delete creatorToAdd.honorificPrefix;
    if (!creatorToAdd.orcid) delete creatorToAdd.orcid;

    if (editingIndex !== null) {
      // Update existing
      creators = creators.map((c, i) => (i === editingIndex ? creatorToAdd : c));
      editingIndex = null;
    } else {
      // Add new
      creators = [...creators, creatorToAdd];
    }

    newCreator = createEmptyCreator();
    showAddForm = false;
    onchange(creators);
  }

  /**
   * Remove a creator
   * @param {number} index
   */
  function removeCreator(index) {
    creators = creators.filter((_, i) => i !== index);
    onchange(creators);
  }

  /**
   * Edit a creator
   * @param {number} index
   */
  function editCreator(index) {
    // Merge over an empty creator so optional keys removed on save (pubkey,
    // affiliationName, honorificPrefix) come back as '' — otherwise binding
    // `undefined` to a child prop with a fallback throws props_invalid_value.
    newCreator = { ...createEmptyCreator(), ...creators[index] };
    editingIndex = index;
    showAddForm = true;
  }

  /**
   * Cancel adding/editing
   */
  function cancelAdd() {
    newCreator = createEmptyCreator();
    editingIndex = null;
    showAddForm = false;
    orcidInvalid = false;
    pubkeyInvalid = false;
  }

  /**
   * Handle form submission
   * @param {Event} e
   */
  function handleSubmit(e) {
    e.preventDefault();
    addCreator();
  }

  /**
   * Get display text for creator type
   * Note: Currently unused - kept for future UI enhancements
   * @param {'Person' | 'Organization'} type
   * @returns {string}
   */
  function _getTypeLabel(type) {
    return type === 'Person'
      ? `👤 ${m.amb_creator_type_person()}`
      : `🏢 ${m.amb_creator_type_organization()}`;
  }

  /**
   * Handle pubkey field blur - normalize and auto-fill name from profile
   */
  async function handlePubkeyBlur() {
    const input = newCreator.pubkey?.trim();
    if (!input) return;

    // Validate and normalize to hex
    const hexPubkey = normalizeToHex(input);
    if (!hexPubkey) return; // Invalid input

    // Store normalized hex pubkey
    newCreator.pubkey = hexPubkey;

    // Only fetch profile if name is empty
    if (newCreator.name.trim()) return;

    isLoadingProfile = true;
    try {
      const profile = await fetchProfileData(hexPubkey);
      // @ts-ignore - profile has name property from fetchProfileData
      if (profile && typeof profile.name === 'string' && profile.name !== 'Anonymous') {
        // @ts-ignore
        newCreator.name = profile.name;
      }
    } catch (error) {
      console.warn('Failed to fetch profile:', error);
    } finally {
      isLoadingProfile = false;
    }
  }
</script>

<div class="creator-input form-control w-full">
  <!-- Label -->
  {#if label}
    <div class="label">
      <span class="label-text font-medium">
        {label}
        {#if required}
          <span class="text-error">*</span>
        {/if}
      </span>
    </div>
  {/if}

  <!-- Existing Creators List -->
  {#if creators.length > 0}
    <div class="mb-3 space-y-2">
      {#each creators as creator, index (index)}
        <div class="flex items-center gap-3 rounded-lg bg-base-200 p-3">
          <div class="placeholder avatar">
            <div
              class="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-neutral text-neutral-content"
            >
              {#if creator.pubkey}
                {@const getProfile = useUserProfile(creator.pubkey)}
                {#if getProfile() && getProfilePicture(getProfile())}
                  <img
                    src={getProfilePicture(getProfile())}
                    alt={creator.name}
                    class="h-full w-full object-cover"
                  />
                {:else if creator.type === 'Organization'}
                  <span class="text-lg">🏢</span>
                {:else}
                  <span class="text-lg">{creator.name[0]?.toUpperCase() || '?'}</span>
                {/if}
              {:else if creator.type === 'Organization'}
                <span class="text-lg">🏢</span>
              {:else}
                <span class="text-lg">{creator.name[0]?.toUpperCase() || '?'}</span>
              {/if}
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate font-medium text-base-content">
              {#if creator.honorificPrefix}
                {creator.honorificPrefix}
              {/if}
              {creator.name}
            </div>
            <div class="flex items-center gap-2 text-xs text-base-content/60">
              <span>{creator.type}</span>
              {#if creator.affiliationName}
                <span>• {creator.affiliationName}</span>
              {/if}
              {#if creator.pubkey}
                <span class="badge badge-xs badge-primary">Nostr</span>
              {/if}
              {#if creator.orcid}
                <span class="badge badge-xs badge-success">ORCID</span>
              {/if}
            </div>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            onclick={() => editCreator(index)}
            aria-label={m.amb_creator_edit_aria()}
          >
            {m.common_edit()}
          </button>
          <button
            type="button"
            class="btn text-error btn-ghost btn-xs"
            onclick={() => removeCreator(index)}
            aria-label={m.amb_creator_remove_aria()}
          >
            <CloseIcon class_="w-4 h-4" />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Add Creator Form -->
  {#if showAddForm}
    <form onsubmit={handleSubmit} class="space-y-3 rounded-lg bg-base-200 p-4">
      <div class="mb-2 flex items-center justify-between">
        <span class="text-sm font-medium">
          {editingIndex !== null ? m.amb_creator_heading_edit() : m.amb_creator_heading_add()}
        </span>
        <button type="button" class="btn btn-ghost btn-xs" onclick={cancelAdd}>
          {m.common_cancel()}
        </button>
      </div>

      <!-- Nostr Pubkey / Contact Search - First field for auto-fill -->
      <div class="form-control">
        <label class="label py-1" for="creator-pubkey">
          <span class="label-text text-sm">{m.amb_creator_label_nostr()}</span>
        </label>
        <ContactSearchInput
          bind:value={newCreator.pubkey}
          id="creator-pubkey"
          placeholder={m.amb_creator_placeholder_search()}
          inputClass="input-sm {pubkeyInvalid ? 'input-error' : ''}"
          exclude={creators.map((c) => c.pubkey || '').filter((p) => p !== '')}
          onselect={(contact) => {
            pubkeyInvalid = false;
            newCreator.pubkey = contact.pubkey;
            newCreator.name = contact.display_name || contact.name || '';
          }}
          onblur={handlePubkeyBlur}
        />
        {#if pubkeyInvalid}
          <p class="creator-pubkey-error mt-1 text-xs text-error">
            {m.amb_creator_error_pubkey_invalid()}
          </p>
        {/if}
      </div>

      <!-- Name -->
      <div class="form-control">
        <label class="label py-1" for="creator-name">
          <span class="label-text flex items-center gap-2 text-sm">
            {m.amb_creator_label_name()} <span class="text-error">*</span>
            {#if isLoadingProfile}
              <span class="loading loading-xs loading-spinner"></span>
            {/if}
          </span>
        </label>
        <input
          id="creator-name"
          type="text"
          class="input-bordered input input-sm w-full"
          bind:value={newCreator.name}
          placeholder={m.amb_creator_placeholder_name()}
          required
        />
      </div>

      <!-- Type -->
      <div class="form-control">
        <label class="label py-1" for="creator-type">
          <span class="label-text text-sm">{m.amb_creator_label_type()}</span>
        </label>
        <select
          id="creator-type"
          class="select-bordered select w-full select-sm"
          bind:value={newCreator.type}
        >
          <option value="Person">👤 {m.amb_creator_type_person()}</option>
          <option value="Organization">🏢 {m.amb_creator_type_organization()}</option>
        </select>
      </div>

      <!-- Honorific Prefix (for persons) -->
      {#if newCreator.type === 'Person'}
        <div class="form-control">
          <label class="label py-1" for="creator-title">
            <span class="label-text text-sm">{m.amb_creator_label_title()}</span>
          </label>
          <input
            id="creator-title"
            type="text"
            class="input-bordered input input-sm w-full"
            bind:value={newCreator.honorificPrefix}
            placeholder={m.amb_creator_placeholder_title()}
          />
        </div>

        <!-- ORCID iD (for persons) -->
        <div class="form-control">
          <label class="label py-1" for="creator-orcid">
            <span class="label-text text-sm">{m.amb_creator_label_orcid()}</span>
          </label>
          <input
            id="creator-orcid"
            type="text"
            class="input-bordered input input-sm w-full {orcidInvalid ? 'input-error' : ''}"
            bind:value={newCreator.orcid}
            oninput={() => (orcidInvalid = false)}
            placeholder={m.amb_creator_placeholder_orcid()}
            aria-invalid={orcidInvalid}
          />
          {#if orcidInvalid}
            <p class="mt-1 text-xs text-error">{m.amb_creator_error_orcid_invalid()}</p>
          {/if}
        </div>
      {/if}

      <!-- Affiliation -->
      <div class="form-control">
        <label class="label py-1" for="creator-affiliation">
          <span class="label-text text-sm">{m.amb_creator_label_affiliation()}</span>
        </label>
        <input
          id="creator-affiliation"
          type="text"
          class="input-bordered input input-sm w-full"
          bind:value={newCreator.affiliationName}
          placeholder={m.amb_creator_placeholder_affiliation()}
        />
      </div>

      <!-- Submit Button -->
      <button
        type="submit"
        class="btn w-full btn-sm btn-primary"
        disabled={!newCreator.name.trim()}
      >
        {editingIndex !== null ? m.amb_creator_button_update() : m.amb_creator_button_add()}
      </button>
    </form>
  {:else}
    <!-- Add Button -->
    <button
      type="button"
      class="btn w-full btn-outline btn-sm"
      onclick={() => (showAddForm = true)}
    >
      <PlusIcon class_="w-4 h-4" />
      {m.amb_creator_button_add()}
    </button>
  {/if}

  <!-- Help Text -->
  {#if helpText}
    <p class="mt-1 text-xs text-base-content/60">{helpText}</p>
  {/if}
</div>
