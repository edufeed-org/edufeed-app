<!-- FeedCard stand-in that only exposes the card title, for list tests. -->
<script>
  let { title = '' } = $props();
</script>

<div data-testid="feed-card" data-title={title}>{title}</div>
