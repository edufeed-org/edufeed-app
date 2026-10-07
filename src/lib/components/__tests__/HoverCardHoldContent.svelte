<script>
  import { useHoverCardHold } from '../shared/hover-card-hold.js';

  /** @type {{ promise: Promise<unknown> }} */
  let { promise } = $props();
  const hold = useHoverCardHold();
</script>

<button
  type="button"
  data-testid="hold-button"
  onclick={(e) => {
    // Like every real button inside a card: don't let the click bubble to
    // the wrapper's own toggle.
    e.stopPropagation();
    hold(promise);
  }}>Hold</button
>
