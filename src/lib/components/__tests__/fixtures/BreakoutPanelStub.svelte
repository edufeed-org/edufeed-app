<script>
  /** Stand-in for the lazily loaded BreakoutPanel: exposes the stage's callbacks. */
  let { breakout, onExtend, onSetDeadline, onClose } = $props();
</script>

<div data-testid="breakout-panel-stub" data-remaining={breakout.remaining ?? ''}>
  <button data-testid="stub-breakout-extend" onclick={() => onExtend(5)}>extend</button>
  <button data-testid="stub-breakout-set" onclick={() => onSetDeadline(10)}>set</button>
  <button data-testid="stub-breakout-clear" onclick={() => onSetDeadline(null)}>clear</button>
  <button data-testid="stub-breakout-close" onclick={onClose}>close</button>
</div>
