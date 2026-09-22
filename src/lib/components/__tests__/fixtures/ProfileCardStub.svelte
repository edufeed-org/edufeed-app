<script>
  let { pubkey, size = 'md' } = $props();
</script>

<div data-testid="profile-card-stub" data-size={size}>{pubkey.slice(0, 8)}</div>
