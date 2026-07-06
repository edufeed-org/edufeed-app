<script>
  let { onsubmitted } = $props();
</script>

<div data-testid="membership-application-form-mock">
  <button type="button" data-testid="membership-form-submit" onclick={() => onsubmitted?.()}>
    submit application
  </button>
</div>
