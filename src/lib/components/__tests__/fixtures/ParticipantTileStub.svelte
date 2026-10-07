<script>
  /** Records the identity, isGuest flag and role a caller hands ParticipantTile, nothing else. */
  let { participant, isGuest = false, role = null } = $props();
</script>

<span
  data-testid="participant-tile-stub"
  data-identity={participant?.identity}
  data-guest={isGuest}
  data-role={role ?? ''}
></span>
