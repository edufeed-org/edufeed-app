<script>
  /** Records the pubkey a caller hands ProfileAvatar, nothing else. */
  let { pubkey = '' } = $props();
</script>

<span data-testid="profile-avatar-stub" data-pubkey={pubkey}></span>
