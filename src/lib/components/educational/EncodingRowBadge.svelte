<script>
  import LicenseBadge from '../shared/LicenseBadge.svelte';
  import { useLicenseForHash } from '$lib/stores/image-license.svelte.js';

  let { sha256 = '' } = $props();

  const getLicense = useLicenseForHash(() => sha256 || null);
  const license = $derived(getLicense());
</script>

{#if license}
  <LicenseBadge licenseEvent={license} class="ml-2" />
{/if}
