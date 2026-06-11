<script>
  import { SvelteSet } from 'svelte/reactivity';
  let { selected = $bindable(new SvelteSet()) } = $props();
</script>

<div data-testid="signup-community-picker-mock">picker mock</div>
