<script>
  /** Records the identity, isGuest flag, role and pin wiring a caller hands ParticipantTile, nothing else. */
  let { participant, isGuest = false, role = null, onTogglePin = undefined } = $props();
</script>

<span
  data-testid="participant-tile-stub"
  data-identity={participant?.identity}
  data-guest={isGuest}
  data-role={role ?? ''}
></span>
{#if onTogglePin}
  <button data-testid="tile-pin-stub" onclick={onTogglePin}>pin</button>
{/if}
