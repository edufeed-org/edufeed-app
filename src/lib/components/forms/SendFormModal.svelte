<script>
  import { nip19 } from 'nostr-tools';
  import { createAppEventFactory } from '$lib/helpers/event-factory.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import {
    publishEvent,
    buildPTagsWithHints,
    buildATagWithHint
  } from '$lib/services/publish-service.js';
  import { FORM_REQUEST_KIND, nip44EncryptWith, signerHasNip44 } from '$lib/helpers/forms.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { CloseIcon } from '$lib/components/icons';
  import ContactSearchInput from '$lib/components/shared/ContactSearchInput.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   formEvent: import('nostr-tools').NostrEvent,
   *   formAddress: string,
   *   onclose: () => void
   * }}
   */
  let { formEvent, formAddress, onclose } = $props();

  let recipientInput = $state('');
  let message = $state('');
  let isSending = $state(false);
  let error = $state('');

  const canEncrypt = $derived(signerHasNip44(manager.active?.signer));

  /** @type {HTMLDialogElement | undefined} */
  let dialogEl = $state(undefined);

  $effect(() => {
    if (dialogEl) {
      dialogEl.showModal();
    }
  });

  function handleDialogClose() {
    onclose();
  }

  /**
   * Decode npub/nprofile to hex pubkey
   * @param {string} input
   * @returns {{ pubkey: string, relays?: string[] } | null}
   */
  function decodeRecipient(input) {
    const trimmed = input.trim();
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === 'npub') {
        return { pubkey: decoded.data };
      }
      if (decoded.type === 'nprofile') {
        return { pubkey: decoded.data.pubkey, relays: decoded.data.relays };
      }
    } catch {
      // Not a valid nip19 string
    }
    return null;
  }

  async function handleSend() {
    if (!manager.active) return;

    error = '';
    const recipient = decodeRecipient(recipientInput);
    if (!recipient) {
      error = m.send_form_invalid_recipient();
      return;
    }

    if (recipient.pubkey === manager.active.pubkey) {
      error = m.send_form_self_error();
      return;
    }

    isSending = true;

    try {
      const signer = manager.active.signer;

      // Build tags with relay hints
      const pTags = await buildPTagsWithHints([recipient.pubkey]);
      const aTag = await buildATagWithHint(formAddress);

      /** @type {string[][]} */
      const tags = [...pTags, aTag];

      // Encrypt message content with NIP-44 (button is disabled when not supported,
      // but re-check defensively in case the signer changed mid-flow)
      if (!signerHasNip44(signer)) {
        error = m.send_form_no_encryption();
        return;
      }
      const payload = JSON.stringify({ message: message.trim() });
      const content = await nip44EncryptWith(signer, recipient.pubkey, payload);

      const factory = createAppEventFactory({ signer });
      const template = await factory.build({ kind: FORM_REQUEST_KIND, tags, content });
      const signed = await factory.sign(template);
      await publishEvent(signed, [recipient.pubkey]);
      eventStore.add(signed);

      showToast(m.send_form_success(), 'success');
      onclose();
    } catch (err) {
      error = err instanceof Error ? err.message : m.send_form_error();
    } finally {
      isSending = false;
    }
  }
</script>

<dialog bind:this={dialogEl} class="modal" onclose={handleDialogClose}>
  <div class="modal-box max-w-md">
    <div class="mb-4 flex items-center justify-between">
      <h3 class="text-lg font-bold">{m.send_form_title()}</h3>
      <form method="dialog">
        <button class="btn btn-circle btn-ghost btn-sm">
          <CloseIcon class_="h-5 w-5" />
        </button>
      </form>
    </div>

    <div class="space-y-4">
      <!-- Form name (read-only) -->
      <div class="text-sm text-base-content/60">
        {formEvent.tags.find((t) => t[0] === 'name')?.[1] || 'Untitled Form'}
      </div>

      <!-- Recipient input -->
      <div class="form-control">
        <label class="label" for="recipient-input">
          <span class="label-text">{m.send_form_recipient_label()}</span>
        </label>
        <ContactSearchInput
          bind:value={recipientInput}
          id="recipient-input"
          placeholder="npub1... / nprofile1..."
          disabled={isSending}
          inputClass="font-mono text-sm"
          exclude={manager.active ? [manager.active.pubkey] : []}
          onselect={(contact) => {
            recipientInput = nip19.npubEncode(contact.pubkey);
          }}
        />
      </div>

      <!-- Optional message -->
      <div class="form-control">
        <label class="label" for="message-input">
          <span class="label-text">{m.send_form_message_label()}</span>
        </label>
        <textarea
          id="message-input"
          class="textarea-bordered textarea w-full"
          rows="3"
          placeholder={m.send_form_message_placeholder()}
          bind:value={message}
          disabled={isSending}
        ></textarea>
      </div>

      {#if !canEncrypt}
        <div class="alert text-sm alert-warning">
          {m.send_form_no_encryption()}
        </div>
      {/if}

      {#if error}
        <div class="alert text-sm alert-error">{error}</div>
      {/if}

      <div class="modal-action">
        <button class="btn btn-ghost" onclick={onclose} disabled={isSending}>
          {m.common_cancel()}
        </button>
        <button
          class="btn btn-primary"
          onclick={handleSend}
          disabled={isSending || !recipientInput.trim() || !canEncrypt}
        >
          {#if isSending}
            <span class="loading loading-sm loading-spinner"></span>
          {/if}
          {m.send_form_send_button()}
        </button>
      </div>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button>close</button>
  </form>
</dialog>
