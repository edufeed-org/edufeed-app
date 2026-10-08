<script>
  /**
   * Stand-in for the lazily loaded CallChatPanel: its own behavior (sending,
   * rendering messages) is covered by CallChatPanel.test.js. Rendering the
   * real component here would pull in livekit-connection.svelte.js (and
   * transitively livekit-client) into this test's module graph.
   * @type {{identityToPubkey?: (identity: string) => string | null, onClose?: () => void}}
   */
  let { identityToPubkey = undefined, onClose = undefined } = $props();
</script>

<div
  data-testid="call-chat-panel"
  data-has-identity-to-pubkey={typeof identityToPubkey === 'function'}
>
  {#if onClose}
    <button type="button" data-testid="call-chat-panel-stub-close" onclick={onClose}>close</button>
  {/if}
</div>
