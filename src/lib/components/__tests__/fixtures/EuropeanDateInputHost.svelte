<!--
  Test host for EuropeanDateInput: provides a real `bind:value` target so
  component tests can observe what the input actually binds (the ISO string),
  and can drive external value changes (edit-mode prefill).
-->
<script>
  import EuropeanDateInput from '../../shared/EuropeanDateInput.svelte';

  let { initial = '', onValue = /** @type {(v: string) => void} */ (() => {}) } = $props();

  // Deliberate one-time seed from the prop (state_referenced_locally is fine here).
  let value = $state(initial);

  $effect(() => {
    onValue(value);
  });

  /** @param {string} v */
  export function setValue(v) {
    value = v;
  }
</script>

<EuropeanDateInput bind:value id="test-date" />
