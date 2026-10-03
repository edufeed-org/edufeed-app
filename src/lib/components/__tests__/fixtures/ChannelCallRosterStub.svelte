<!-- Stand-in for ChannelCallRoster in rail tests: the real roster opens a
  kind-39004 subscription; the tests only need to know WHICH channel got one
  and that its "open" callback selects that channel. -->
<script>
  let { pointer, onOpen } = $props();
</script>

<button type="button" data-testid="channel-call-roster-stub" onclick={() => onOpen()}
  >{pointer.id}</button
>
