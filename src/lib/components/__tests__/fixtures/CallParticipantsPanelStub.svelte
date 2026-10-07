<script>
  /** Records the rows the stage hands CallParticipantsPanel, exposes its callbacks and renders its menu extras. */
  let { rows, onTogglePin, onVolumeChange, onClose, menuExtras = undefined } = $props();
</script>

<div data-testid="call-participants-panel-stub">
  {#each rows as row (row.key)}
    <span
      data-testid="participants-row-stub"
      data-key={row.key}
      data-identity={row.participant.identity}
      data-local={row.isLocal}
      data-mic-off={row.micOff}
      data-speaking={row.speaking}
      data-hand={row.handRaised}
      data-guest={row.guest}
      data-listen-only={row.listenOnly}
      data-pinned={row.pinned}
      data-volume={row.volume}
      data-pubkey={row.pubkey}
      data-role={row.role ?? ''}
    ></span>
    <ul data-testid="stub-menu-{row.key}">{@render menuExtras?.(row)}</ul>
    <button data-testid="stub-pin-{row.key}" onclick={() => onTogglePin(row.key)}>pin</button>
    <button data-testid="stub-volume-{row.key}" onclick={() => onVolumeChange(row.pubkey, 0.5)}
      >vol</button
    >
  {/each}
  <button data-testid="stub-close" onclick={onClose}>close</button>
</div>
