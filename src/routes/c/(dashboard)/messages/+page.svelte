<script>
  import { createConversationIdentifier } from 'applesauce-common/helpers/messages';
  import ConversationList from '$lib/components/dm/ConversationList.svelte';
  import ConversationThread from '$lib/components/dm/ConversationThread.svelte';
  import DmComposer from '$lib/components/dm/DmComposer.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { getDmRelays, hasDmRelayList } from '$lib/services/dm-service.svelte.js';
  import * as m from '$lib/paraglide/messages';
  import { getContext, onDestroy } from 'svelte';

  /** @type {{ data: import('./$types').PageData }} */
  let { data } = $props();

  const getActiveUser = useActiveUser();

  /** @type {string | null} */
  let selectedConversationId = $state(null);
  /** @type {string[]} */
  let selectedParticipants = $state([]);
  let showComposer = $state(false);
  let didAutoOpen = false;

  // Auto-open conversation when navigated with ?to=<pubkey> (run once)
  $effect(() => {
    const user = getActiveUser();
    if (data.to && user && !didAutoOpen) {
      didAutoOpen = true;
      const convId = createConversationIdentifier(data.to);
      const allParticipants = [...new Set([user.pubkey, data.to])];
      selectedConversationId = convId;
      selectedParticipants = allParticipants;
    }
  });

  let dmRelays = $derived(getDmRelays());
  let hasDedicatedRelays = $derived(hasDmRelayList());

  // Report to the root layout that we have our own bottom UI (DM composer)
  // only when a thread is actually open. On the list view, the bottom nav
  // should remain visible so users can navigate away on mobile.
  const setPageHasOwnBottomUI =
    /** @type {((g: (() => boolean) | undefined) => void) | undefined} */ (
      getContext('setPageHasOwnBottomUI')
    );
  setPageHasOwnBottomUI?.(() => selectedConversationId !== null);
  onDestroy(() => setPageHasOwnBottomUI?.(undefined));

  // We always have our own primary create action (the "Neu" button in
  // ConversationList, plus the in-thread composer). Suppress the global FAB
  // so users aren't presented with a generic "create anything" menu when the
  // contextual action is "start a new conversation".
  const setPageHasOwnCreateAction =
    /** @type {((g: (() => boolean) | undefined) => void) | undefined} */ (
      getContext('setPageHasOwnCreateAction')
    );
  setPageHasOwnCreateAction?.(() => true);
  onDestroy(() => setPageHasOwnCreateAction?.(undefined));

  /**
   * @param {string} id
   * @param {string[]} participants
   */
  function selectConversation(id, participants) {
    selectedConversationId = id;
    selectedParticipants = participants;
    showComposer = false;
  }

  function goBack() {
    selectedConversationId = null;
    selectedParticipants = [];
  }

  /**
   * @param {string} id
   * @param {string[]} participants
   */
  function handleStartConversation(id, participants) {
    const user = getActiveUser();
    if (user) {
      // Include self in participants for conversation identifier
      const allParticipants = [...new Set([user.pubkey, ...participants])];
      selectConversation(id, allParticipants);
    }
  }
</script>

<svelte:head><title>{m.dm_title()}</title></svelte:head>

<div class="flex h-full w-full overflow-hidden">
  <!-- Left pane: Conversation list (hidden on mobile when a conversation is selected) -->
  <div
    class="w-full shrink-0 md:w-80 {selectedConversationId
      ? 'hidden md:flex md:flex-col'
      : 'flex flex-col'}"
  >
    {#if showComposer}
      <DmComposer
        onStartConversation={handleStartConversation}
        onCancel={() => (showComposer = false)}
      />
    {/if}
    <ConversationList
      {selectedConversationId}
      onSelectConversation={selectConversation}
      onNewMessage={() => (showComposer = !showComposer)}
    />
  </div>

  <!-- Right pane: Thread or empty state -->
  <div
    class="min-w-0 flex-1 bg-base-100 {selectedConversationId
      ? 'flex flex-col'
      : 'hidden md:flex md:flex-col'}"
  >
    {#if selectedConversationId}
      <ConversationThread
        conversationId={selectedConversationId}
        participants={selectedParticipants}
        onBack={goBack}
      />
    {:else}
      <div class="flex h-full flex-col items-center justify-center text-base-content/50">
        <p>{m.dm_select_conversation()}</p>
        {#if dmRelays.length > 0 && !hasDedicatedRelays}
          <div class="mt-4 max-w-xs text-center text-sm">
            <p>{m.dm_no_relays_hint()}</p>
            <a href="/settings" class="btn mt-2 btn-ghost btn-sm">
              {m.dm_go_to_settings()}
            </a>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
