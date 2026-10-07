<!-- Test stub for FeedCard: exposes the event kind and id only. -->
<script>
  let { kind, event } = $props();
</script>

<div data-testid="feed-card" data-kind={kind} data-id={event?.id}></div>
