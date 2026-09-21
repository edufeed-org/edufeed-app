<script>
  // Stand-in for the real profile hover card body: exposes the pubkey and the
  // resolved display name so tests can prove the hero hands it the right
  // identity AND the right profile SHAPE (see the community dual-shape hazard:
  // /c passes already-parsed content, elsewhere it is a kind-0 event).
  let { pubkey = '', profile = undefined } = $props();
</script>

<div data-testid="profile-hover-card" data-pubkey={pubkey}>
  {profile?.name ?? 'no-profile'}
</div>
