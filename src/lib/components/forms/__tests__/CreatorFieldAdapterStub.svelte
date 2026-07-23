<script>
  // Stub for CreatorInput. Renders its `label` prop when truthy so tests can
  // detect a duplicated heading (FieldsRenderer already renders the label).
  let { creators = [], label = '', onchange } = $props();
  $effect(() => {
    onchange([{ name: 'Alice', type: 'Person' }]);
  });
</script>

<div data-testid="creator-stub">
  {#if label}<span>{label}</span>{/if}
  {creators.length}
</div>
