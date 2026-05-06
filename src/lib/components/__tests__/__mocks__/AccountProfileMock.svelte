<!-- Minimal stand-in for AccountProfile used in LoginModal tests. Exposes a
     queryable element with the account id so structural tests can verify
     ordering and presence without pulling in profile/relay infrastructure. -->
<script>
  let { account } = $props();
</script>

<li data-testid="saved-account-mock" data-account-id={account.id}>{account.id}</li>
