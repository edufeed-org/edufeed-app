<!-- DetailHeader stand-in that exposes the props a generic detail view hands
     it (title, author, delete availability) and still renders the metadata
     snippet so kind badges can be asserted. -->
<script>
  let { title = '', authorPubkey = '', onDelete = undefined, metadata = undefined } = $props();
</script>

<div
  data-testid="detail-header-stub"
  data-title={title}
  data-author={authorPubkey}
  data-can-delete={String(!!onDelete)}
>
  {#if metadata}{@render metadata()}{/if}
</div>
