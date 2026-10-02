<!-- Stand-in for GroupChat in PrivateChannelsView tests: the real chat
  opens relay subscriptions; the tests only need to know WHICH pointer the
  pane decided to render, and whether the pane handed it a way back. -->
<script>
  let { pointer, onBack = undefined, isCommunityRoot = false } = $props();
</script>

<div data-testid="group-chat-stub" data-community-root={String(isCommunityRoot)}>
  {pointer.relay}'{pointer.id}
</div>
{#if onBack}
  <button type="button" data-testid="group-chat-stub-back" onclick={onBack}>back</button>
{/if}
