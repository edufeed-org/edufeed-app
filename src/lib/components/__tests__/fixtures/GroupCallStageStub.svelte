<script>
  /**
   * Stand-in for the lazily loaded GroupCallStage: records its props only.
   * @type {{title?: string, onLeave?: () => void, onShowChat?: () => void, registerView?: () => () => void}}
   */
  let {
    title = '',
    onLeave = () => {},
    onShowChat = undefined,
    registerView = undefined
  } = $props();

  $effect(() => registerView?.());
</script>

<div data-testid="group-call-stage-stub">
  {title}
  <button type="button" data-testid="group-call-stage-stub-leave" onclick={onLeave}>leave</button>
  {#if onShowChat}
    <button type="button" data-testid="group-call-stage-stub-chat" onclick={onShowChat}>chat</button
    >
  {/if}
</div>
