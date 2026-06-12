<!-- Test stub for NostrIdentifier: exposes the identifier + inline props in the
     DOM so NostrContentRenderer tests can assert what was passed. -->
<script>
  let { identifier = '', inline = false } = $props();
</script>

<span data-testid="nostr-card" data-identifier={identifier} data-inline={String(inline)}
  >{identifier}</span
>
