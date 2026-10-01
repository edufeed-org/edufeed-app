<!--
  CallChatPanel — the call's own chat (LiveKit data, livekit-connection's
  CHAT_TOPIC). Everyone in the call sees it, guests included; it is gone
  when the call ends. The channel chat stays members-only.
-->
<script>
  import { tick } from 'svelte';
  import { getLiveKitState, sendCallChat } from '$lib/services/livekit-connection.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{identityToPubkey: (identity: string) => string | null}} */
  let { identityToPubkey } = $props();

  const lk = getLiveKitState();
  let draft = $state('');
  /** @type {HTMLDivElement | undefined} */
  let listEl = $state(undefined);

  const getProfiles = useProfileMap(() =>
    lk.callChat
      .map((c) => identityToPubkey(c.identity))
      .filter((/** @type {string | null} */ pk) => typeof pk === 'string')
  );

  /** @param {string} identity */
  function nameOf(identity) {
    const pk = identityToPubkey(identity);
    const p = pk ? getProfiles().get(pk) : undefined;
    return p?.display_name || p?.name || pk?.slice(0, 8) || '?';
  }

  $effect(() => {
    const count = lk.callChat.length;
    void count;
    tick().then(() => {
      if (typeof listEl?.scrollTo === 'function') {
        listEl.scrollTo({ top: listEl.scrollHeight });
      }
    });
  });

  // Not connected (the server ended the call): the messages stay readable,
  // nothing can be sent.
  const canSend = $derived(lk.isConnected && lk.canSignal);

  async function send() {
    if (!canSend) return;
    const text = draft;
    draft = '';
    await sendCallChat(text);
  }
</script>

<div class="flex min-h-0 flex-1 flex-col" data-testid="call-chat-panel">
  <div bind:this={listEl} class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
    {#if lk.callChat.length === 0}
      <p class="m-auto text-center text-sm text-base-content/60">{m.groups_call_chat_empty()}</p>
    {/if}
    {#each lk.callChat as msg (msg.id)}
      <div class="text-sm" data-testid="call-chat-message">
        <span class="font-semibold">{nameOf(msg.identity)}</span>
        <span class="break-words whitespace-pre-wrap">{msg.text}</span>
      </div>
    {/each}
  </div>
  <form
    class="flex gap-2 border-t border-base-300 p-2"
    onsubmit={(e) => {
      e.preventDefault();
      send();
    }}
  >
    <input
      class="input-bordered input input-sm flex-1"
      maxlength="2000"
      placeholder={m.groups_call_chat_placeholder()}
      bind:value={draft}
      disabled={!canSend}
      data-testid="call-chat-input"
      onkeydown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      }}
    />
    <button
      type="submit"
      class="btn btn-sm btn-primary"
      disabled={!canSend}
      data-testid="call-chat-send"
    >
      {m.groups_call_chat_send()}
    </button>
  </form>
</div>
