<!-- Stand-in for GroupChat in PrivateChannelsView tests: the real chat
  opens relay subscriptions; the tests only need to know WHICH pointer the
  pane decided to render. -->
<script>
  let { pointer } = $props();
</script>

<div data-testid="group-chat-stub">{pointer.relay}'{pointer.id}</div>
