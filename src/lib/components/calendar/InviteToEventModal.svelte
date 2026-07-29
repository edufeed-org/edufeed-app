<!--
  InviteToEventModal - Invite people to a calendar event via private NIP-17 DMs.
  The invitation is an ordinary DM: optional personal note + nostr:naddr link.
  Opened via modalStore.openModal('inviteToEvent', { rawEvent }). Rendered
  only while active (ModalManager mounts/unmounts it), so no <dialog>.showModal()
  plumbing is needed — see ResourceVariantPickerModal for the same pattern.
-->

<script>
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import ContactSearchInput from '$lib/components/shared/ContactSearchInput.svelte';
  import { sendWrappedDm } from '$lib/services/wrapped-dm.js';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { CloseIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  let { modalId = 'invite-to-event-modal' } = $props();

  /** @type {import('nostr-tools').NostrEvent | null} */
  let rawEvent = $derived(
    /** @type {any} */ (/** @type {any} */ (modalStore.modalProps)?.rawEvent) || null
  );

  /** @type {string[]} */
  let recipients = $state([]);
  let searchValue = $state('');
  let note = $state('');
  let isSending = $state(false);
  /** @type {Record<string, 'sent' | 'failed'>} */
  let sendStatus = $state({});
  let hasSent = $state(false);

  const getProfiles = useProfileMap(() => recipients);
  let profiles = $derived(getProfiles());

  let failedRecipients = $derived(recipients.filter((p) => sendStatus[p] === 'failed'));
  // Recipients added after a send round, never attempted yet.
  let pendingRecipients = $derived(recipients.filter((p) => !sendStatus[p]));
  let allSent = $derived(
    hasSent && recipients.length > 0 && recipients.every((p) => sendStatus[p] === 'sent')
  );

  /** @param {string} pubkey */
  function addRecipient(pubkey) {
    if (pubkey && !recipients.includes(pubkey)) {
      recipients = [...recipients, pubkey];
    }
    searchValue = '';
  }

  /** @param {string} pubkey */
  function removeRecipient(pubkey) {
    recipients = recipients.filter((p) => p !== pubkey);
  }

  /** @returns {string} */
  function buildInviteContent() {
    if (!rawEvent) return '';
    const link = `nostr:${encodeEventToNaddr(rawEvent)}`;
    const trimmedNote = note.trim();
    return trimmedNote ? `${trimmedNote}\n\n${link}` : link;
  }

  /** @param {string[]} targets */
  async function sendTo(targets) {
    // Never resend to a recipient whose DM already succeeded — guards every
    // send control against duplicate invitations after a partial failure.
    targets = targets.filter((p) => sendStatus[p] !== 'sent');
    if (!rawEvent || targets.length === 0 || isSending) return;
    isSending = true;
    const content = buildInviteContent();
    for (const pubkey of targets) {
      try {
        // sendWrappedDm settles both relay lists first — ours so the reply can
        // reach us, theirs so the wrap goes to the inbox they actually read.
        await sendWrappedDm(pubkey, content);
        sendStatus = { ...sendStatus, [pubkey]: 'sent' };
      } catch (err) {
        console.warn('Invite DM failed for', pubkey, err);
        sendStatus = { ...sendStatus, [pubkey]: 'failed' };
      }
    }
    isSending = false;
    hasSent = true;
  }

  function handleClose() {
    recipients = [];
    searchValue = '';
    note = '';
    sendStatus = {};
    hasSent = false;
    modalStore.closeModal();
  }
</script>

<dialog class="modal-open modal" id={modalId}>
  <div class="modal-box max-w-lg">
    <div class="mb-4 flex items-center justify-between">
      <h3 class="text-lg font-bold">{m.invite_modal_title()}</h3>
      <button
        class="btn btn-circle btn-ghost btn-sm"
        data-testid="invite-close"
        disabled={isSending}
        onclick={handleClose}
        aria-label="Close"
      >
        <CloseIcon class_="w-5 h-5" />
      </button>
    </div>

    <div class="form-control mb-3">
      <label class="label" for="invite-recipient-search">
        <span class="label-text">{m.invite_modal_recipients_label()}</span>
      </label>

      {#if recipients.length > 0}
        <ul class="mb-2 space-y-1">
          {#each recipients as pubkey (pubkey)}
            <li class="flex items-center gap-2 rounded-lg bg-base-200 px-2 py-1">
              <ProfileAvatar {pubkey} size="xs" />
              <span class="min-w-0 flex-1 truncate text-sm">
                {getDisplayName(profiles?.get(pubkey)) || pubkey.slice(0, 12) + '…'}
              </span>
              {#if sendStatus[pubkey] === 'sent'}
                <span class="badge badge-sm badge-success">✓</span>
              {:else if sendStatus[pubkey] === 'failed'}
                <span class="badge badge-sm badge-error">✕</span>
              {/if}
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                disabled={isSending}
                onclick={() => removeRecipient(pubkey)}
              >
                <CloseIcon class_="w-3 h-3" />
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <ContactSearchInput
        id="invite-recipient-search"
        bind:value={searchValue}
        placeholder={m.invite_modal_search_placeholder()}
        disabled={isSending}
        acceptPubkeyInput={true}
        exclude={recipients}
        onselect={(contact) => addRecipient(contact.pubkey)}
        onrawpubkey={(pubkey) => addRecipient(pubkey)}
      />
    </div>

    <div class="form-control mb-3">
      <label class="label" for="invite-note">
        <span class="label-text">{m.invite_modal_note_label()}</span>
      </label>
      <textarea
        id="invite-note"
        data-testid="invite-note"
        class="textarea-bordered textarea w-full"
        rows="2"
        placeholder={m.invite_modal_note_placeholder()}
        bind:value={note}
        disabled={isSending}
      ></textarea>
    </div>

    <p class="mb-4 text-xs text-base-content/60">{m.invite_modal_privacy_hint()}</p>

    {#if allSent}
      <div class="alert text-sm alert-success">{m.invite_modal_sent_all()}</div>
    {:else if hasSent && failedRecipients.length > 0}
      <div class="alert text-sm alert-warning">{m.invite_modal_some_failed()}</div>
    {/if}

    <div class="modal-action">
      {#if hasSent && failedRecipients.length > 0}
        <button
          class="btn btn-warning"
          data-testid="invite-retry"
          disabled={isSending}
          onclick={() => sendTo(failedRecipients)}
        >
          {m.invite_modal_retry_failed()}
        </button>
      {/if}
      <!-- After a send round, only newly added recipients justify the primary
           button; retrying failures is the Retry button's job. -->
      {#if !allSent && (!hasSent || pendingRecipients.length > 0)}
        <button
          class="btn btn-primary"
          data-testid="invite-send"
          disabled={isSending || recipients.length === 0 || !rawEvent}
          onclick={() => sendTo(hasSent ? pendingRecipients : recipients)}
        >
          {isSending ? m.invite_modal_sending() : m.invite_modal_send()}
        </button>
      {/if}
    </div>
  </div>
  <button class="modal-backdrop" disabled={isSending} onclick={handleClose} aria-label="Close"
    >close</button
  >
</dialog>
