<!-- Minimal stand-in for AccountProfile used in LoginModal tests. Exposes a
     queryable element with the account id so structural tests can verify
     ordering and presence without pulling in profile/relay infrastructure.
     The button stands in for the real "set active" button and only fires
     `onSwitch`, so tests can check what the modal does after a switch. -->
<script>
  let { account, onSwitch = undefined } = $props();
</script>

<li data-testid="saved-account-mock" data-account-id={account.id}>
  {account.id}
  <button type="button" data-testid="switch-mock" onclick={() => onSwitch?.()}>switch</button>
</li>
