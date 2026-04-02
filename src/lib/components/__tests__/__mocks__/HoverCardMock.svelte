<script>
  let { trigger, content } = $props();
</script>

<div data-testid="hovercard">
  <div data-testid="hovercard-trigger">
    {@render trigger()}
  </div>
  <div data-testid="hovercard-content">
    {@render content()}
  </div>
</div>
