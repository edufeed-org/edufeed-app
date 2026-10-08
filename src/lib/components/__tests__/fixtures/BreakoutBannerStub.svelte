<script>
  /** Records the props the stage hands BreakoutBanner; a click asks to join the first room. */
  let { breakout, guest, onJoin } = $props();
</script>

<button
  type="button"
  data-testid="breakout-banner-stub"
  data-guest={guest}
  data-rooms={breakout.rooms.length}
  onclick={() => onJoin(breakout.rooms[0])}
>
  banner
</button>
