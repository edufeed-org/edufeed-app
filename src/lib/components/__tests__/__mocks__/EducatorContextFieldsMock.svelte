<script>
  let { onchange } = $props();

  const sample = {
    interests: ['Klettern'],
    educationalLevels: [
      { id: 'https://edufeed.org/ns/bildungsbereich#schule', prefLabel: { de: 'Schule' } }
    ],
    subjects: []
  };
</script>

<div data-testid="educator-context-fields-mock">
  <button
    type="button"
    data-testid="educator-context-set-sample"
    onclick={() => onchange?.(sample)}
  >
    set sample
  </button>
</div>
