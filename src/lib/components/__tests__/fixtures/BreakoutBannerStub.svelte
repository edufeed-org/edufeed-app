<script>
  /** Records the props the stage hands BreakoutBanner; a click asks to join the first room. */
  let { breakout, onJoin } = $props();
</script>

<button
  type="button"
  data-testid="breakout-banner-stub"
  data-rooms={breakout.rooms.length}
  onclick={() => onJoin(breakout.rooms[0])}
>
  banner
</button>
