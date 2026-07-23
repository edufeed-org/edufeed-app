<script>
  let { creators = [], onchange } = $props();
  $effect(() => {
    onchange([{ name: 'Alice', type: 'Person' }]);
  });
</script>

<div data-testid="creator-stub">{creators.length}</div>
