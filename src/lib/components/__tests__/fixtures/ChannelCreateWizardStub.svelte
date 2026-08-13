<script>
  let { community, onCreated } = $props();
</script>

<div data-testid="wizard-community">{community === undefined ? 'undefined' : 'present'}</div>
<button data-testid="stub-fire-created" onclick={() => onCreated('new-id')}>created</button>
