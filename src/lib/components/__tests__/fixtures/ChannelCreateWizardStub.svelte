<script>
  let { community } = $props();
</script>

<div data-testid="wizard-community">{community === undefined ? 'undefined' : 'present'}</div>
