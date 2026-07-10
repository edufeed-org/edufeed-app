<!--
  ParticipantsEditor - Add/remove NIP-52 participants ("p" tags) with roles.
  Bound value shape matches getCalendarEventMetadata().participants:
  Array<{pubkey: string, relay?: string, role?: string}>
-->

<script>
  import ContactSearchInput from '$lib/components/shared/ContactSearchInput.svelte';
  import { getPrimaryWriteRelay } from '$lib/services/relay-service.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { CloseIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{participants?: Array<{pubkey: string, relay?: string, role?: string}>, disabled?: boolean}} */
  let { participants = $bindable([]), disabled = false } = $props();

  const ROLE_PRESETS = ['participant', 'speaker', 'organizer', 'moderator'];
  /** @type {Record<string, () => string>} */
  const roleLabels = {
    participant: m.participant_role_participant,
    speaker: m.participant_role_speaker,
    organizer: m.participant_role_organizer,
    moderator: m.participant_role_moderator
  };

  let searchValue = $state('');
  let selectedRole = $state('participant');
  let customRole = $state('');

  const getProfiles = useProfileMap(() => participants.map((p) => p.pubkey));
  let profiles = $derived(getProfiles());

  /** @param {string} role */
  function roleLabel(role) {
    return roleLabels[role] ? roleLabels[role]() : role;
  }

  /** @param {string} pubkey */
  async function addParticipant(pubkey) {
    if (!pubkey || participants.some((p) => p.pubkey === pubkey)) return;
    const role = selectedRole === 'custom' ? customRole.trim() : selectedRole;
    let relay;
    try {
      relay = (await getPrimaryWriteRelay(pubkey)) || undefined;
    } catch {
      relay = undefined;
    }
    // Re-check after the await: a concurrent call (double-click/re-paste)
    // can have already added this pubkey while the relay lookup was pending.
    if (participants.some((p) => p.pubkey === pubkey)) return;
    participants = [...participants, { pubkey, relay, role: role || undefined }];
    searchValue = '';
  }

  /** @param {string} pubkey */
  function removeParticipant(pubkey) {
    participants = participants.filter((p) => p.pubkey !== pubkey);
  }
</script>

<div class="form-control">
  <label class="label" for="participants-editor-search">
    <span class="label-text">{m.event_modal_participants_label()}</span>
  </label>

  {#if participants.length > 0}
    <ul class="mb-2 space-y-1">
      {#each participants as participant (participant.pubkey)}
        <li class="flex items-center gap-2 rounded-lg bg-base-200 px-2 py-1">
          <ProfileAvatar pubkey={participant.pubkey} size="xs" />
          <span class="min-w-0 flex-1 truncate text-sm">
            {getDisplayName(profiles?.get(participant.pubkey)) ||
              participant.pubkey.slice(0, 12) + '…'}
          </span>
          {#if participant.role}
            <span class="badge badge-outline badge-sm">{roleLabel(participant.role)}</span>
          {/if}
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            data-testid="participant-remove"
            aria-label={m.event_modal_participants_remove()}
            {disabled}
            onclick={() => removeParticipant(participant.pubkey)}
          >
            <CloseIcon class_="w-3 h-3" />
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="flex flex-wrap items-start gap-2">
    <div class="min-w-48 flex-1">
      <ContactSearchInput
        id="participants-editor-search"
        bind:value={searchValue}
        placeholder={m.event_modal_participants_add_placeholder()}
        {disabled}
        acceptPubkeyInput={true}
        exclude={participants.map((p) => p.pubkey)}
        onselect={(contact) => addParticipant(contact.pubkey)}
        onrawpubkey={(pubkey) => addParticipant(pubkey)}
      />
    </div>
    <select
      class="select-bordered select select-sm"
      data-testid="participant-role-select"
      bind:value={selectedRole}
      {disabled}
    >
      {#each ROLE_PRESETS as role (role)}
        <option value={role}>{roleLabel(role)}</option>
      {/each}
      <option value="custom">{m.participant_role_custom()}</option>
    </select>
    {#if selectedRole === 'custom'}
      <input
        type="text"
        class="input-bordered input input-sm w-36"
        data-testid="participant-role-custom"
        placeholder={m.participant_role_custom_placeholder()}
        bind:value={customRole}
        {disabled}
      />
    {/if}
  </div>

  <p class="mt-1 text-xs text-base-content/60">{m.event_modal_participants_help()}</p>
</div>
