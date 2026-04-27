<script>
  let { trigger, content, fixed = false, position = 'bottom' } = $props();
</script>

<div data-testid="hovercard" data-fixed={fixed ? 'true' : 'false'} data-position={position}>
  <div data-testid="hovercard-trigger">
    {@render trigger()}
  </div>
  <div data-testid="hovercard-content">
    {@render content()}
  </div>
</div>
