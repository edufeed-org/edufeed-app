<script>
  /** Records the identity + isGuest flag a caller hands ParticipantTile, nothing else. */
  let { participant, isGuest = false, onTogglePin = undefined } = $props();
</script>

<span data-testid="participant-tile-stub" data-identity={participant?.identity} data-guest={isGuest}
></span>
{#if onTogglePin}
  <button data-testid="tile-pin-stub" onclick={onTogglePin}>pin</button>
{/if}
