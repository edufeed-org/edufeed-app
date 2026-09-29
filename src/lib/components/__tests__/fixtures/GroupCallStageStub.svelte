<script>
  /**
   * Stand-in for the lazily loaded GroupCallStage: records its props only.
   * @type {{token?: string, serverUrl?: string, title?: string, onLeave?: () => void}}
   */
  let { token = '', serverUrl = '', title = '', onLeave = () => {} } = $props();
</script>

<div data-testid="group-call-stage-stub" data-token={token} data-server-url={serverUrl}>
  {title}
  <button type="button" data-testid="group-call-stage-stub-leave" onclick={onLeave}>leave</button>
</div>
