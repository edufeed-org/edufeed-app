<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';

  onMount(() => goto(resolve('/c/inbox'), { replaceState: true }));
</script>

<div class="flex justify-center py-16">
  <span class="loading loading-lg loading-spinner text-primary"></span>
</div>
