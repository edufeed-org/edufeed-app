<script>
  /** Records the identity + isGuest flag a caller hands ParticipantTile, nothing else. */
  let { participant, isGuest = false } = $props();
</script>

<span data-testid="participant-tile-stub" data-identity={participant?.identity} data-guest={isGuest}
></span>
