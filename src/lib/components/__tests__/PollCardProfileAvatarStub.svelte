<script>
  // Test-only stub for ProfileAvatar — exposes pubkey + name on a span so
  // PollCard tests can assert without pulling in loaders / pool.
  let { pubkey = '', profile = null } = $props();
  let name = $derived(profile?.display_name || profile?.name || pubkey.slice(0, 8));
</script>

<span data-pubkey={pubkey} aria-label={name} title={name} role="img">{name}</span>
