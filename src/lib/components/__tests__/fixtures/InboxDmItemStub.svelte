<script>
  // Stand-in for InboxDmItem that exposes which conversation was rendered,
  // so list-level tests can assert the known/requests split.
  let { conversation } = $props();
</script>

<div data-testid="dm-item">{conversation.id}</div>
