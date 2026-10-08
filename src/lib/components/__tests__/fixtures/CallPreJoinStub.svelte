<script>
  /**
   * Stand-in for the lazily loaded CallPreJoin lobby: renders the parent's
   * extra fields and a join button that answers with a fixed media choice.
   * The lobby's own behaviour (preview, meter, devices) is covered by
   * CallPreJoin.test.js; the real one would pull livekit-client in here.
   * @type {{
   *   joinLabel?: string,
   *   onJoin: (media: {audio: boolean, video: boolean}) => void | Promise<void>,
   *   onCancel?: () => void,
   *   busy?: boolean,
   *   error?: string | null,
   *   testid?: string,
   *   children?: import('svelte').Snippet
   * }}
   */
  let {
    joinLabel = '',
    onJoin,
    onCancel = undefined,
    busy = false,
    error = null,
    testid = 'call-prejoin-join',
    children = undefined
  } = $props();
</script>

<div data-testid="call-prejoin-stub" data-busy={busy}>
  {#if children}{@render children()}{/if}
  {#if error}<p data-testid="call-prejoin-error">{error}</p>{/if}
  <button
    type="button"
    data-testid={testid}
    disabled={busy}
    onclick={() => onJoin({ audio: true, video: false })}>{joinLabel}</button
  >
  {#if onCancel}
    <button type="button" data-testid="call-prejoin-cancel" onclick={onCancel}>cancel</button>
  {/if}
</div>
