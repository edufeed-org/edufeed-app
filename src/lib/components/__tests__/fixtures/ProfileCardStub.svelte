<script>
  let { pubkey, size = 'md', showNip05 = false, showAbout = false } = $props();
  const details = $derived([showNip05 && 'nip05', showAbout && 'about'].filter(Boolean).join(','));
</script>

<div data-testid="profile-card-stub" data-size={size} data-details={details}>
  {pubkey.slice(0, 8)}
</div>
