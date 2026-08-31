<!-- Renders the event content verbatim so a test can assert WHICH content
     string a caller handed to NostrContentRenderer (e.g. ChannelChat strips
     attachment URLs before rendering). No markdown/nostr-uri processing. -->
<script>
  let { event } = $props();
</script>

<span data-testid="ncr-content">{event?.content}</span>
