<!--
  Test host for EuropeanTimeInput: provides a real `bind:value` target so
  component tests can observe what the input actually binds (the HH:MM string),
  and can drive external value changes (edit-mode prefill).
-->
<script>
  import EuropeanTimeInput from '../../shared/EuropeanTimeInput.svelte';

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

<EuropeanTimeInput bind:value id="test-time" />
