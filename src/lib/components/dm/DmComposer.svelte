<script>
  import ContactSearchInput from '$lib/components/shared/ContactSearchInput.svelte';
  import { createConversationIdentifier } from 'applesauce-common/helpers/messages';
  import { nip19 } from 'nostr-tools';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   onStartConversation: (conversationId: string, participants: string[]) => void,
   *   onCancel: () => void
   * }}
   */
  let { onStartConversation, onCancel } = $props();

  let searchValue = $state('');
  let error = $state('');

  /**
   * Handle contact selection from search dropdown.
   * @param {any} contact
   */
  function handleContactSelect(contact) {
    if (contact?.pubkey) {
      startConversation(contact.pubkey);
    }
  }

  /** Try to parse the search value as an npub/nprofile and start conversation. */
  function handleManualSubmit() {
    error = '';
    const value = searchValue.trim();
    if (!value) return;

    try {
      if (value.startsWith('npub1')) {
        const { data } = nip19.decode(value);
        startConversation(/** @type {string} */ (data));
        return;
      }
      if (value.startsWith('nprofile1')) {
        const { data } = nip19.decode(value);
        startConversation(/** @type {any} */ (data).pubkey);
        return;
      }
      // Try as raw hex pubkey (64 chars)
      if (/^[0-9a-f]{64}$/i.test(value)) {
        startConversation(value);
        return;
      }
      error = m.dm_invalid_recipient();
    } catch {
      error = m.dm_invalid_recipient();
    }
  }

  /**
   * Start or open conversation with a pubkey.
   * @param {string} pubkey
   */
  function startConversation(pubkey) {
    const convId = createConversationIdentifier(pubkey);
    onStartConversation(convId, [pubkey]);
  }
</script>

<div class="flex flex-col gap-4 px-4 py-4">
  <div class="flex items-center justify-between">
    <h3 class="font-bold">{m.dm_new_conversation()}</h3>
    <button class="btn btn-ghost btn-sm" onclick={onCancel}> ✕ </button>
  </div>

  <div class="flex gap-2">
    <div class="flex-1">
      <ContactSearchInput
        bind:value={searchValue}
        placeholder={m.dm_recipient_placeholder()}
        onselect={handleContactSelect}
      />
    </div>
    <button class="btn btn-sm btn-primary" onclick={handleManualSubmit}>
      {m.dm_start()}
    </button>
  </div>

  {#if error}
    <p class="text-sm text-error">{error}</p>
  {/if}
</div>
