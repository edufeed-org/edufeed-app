<script>
  let { onchange } = $props();

  const sample = {
    interests: ['Klettern'],
    educationalLevels: [
      { id: 'https://edufeed.org/ns/bildungsbereich#schule', prefLabel: { de: 'Schule' } }
    ],
    subjects: []
  };

  const interestsOnly = {
    interests: ['Klettern', 'Podcasts'],
    educationalLevels: [],
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
  <button
    type="button"
    data-testid="educator-context-set-interests-only"
    onclick={() => onchange?.(interestsOnly)}
  >
    set interests only
  </button>
</div>
