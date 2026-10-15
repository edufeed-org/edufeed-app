<script>
  // Test child for the /c layout: pushes header info through the
  // setMobileHeader context the way src/routes/c/[pubkey]/+layout.svelte does.
  import { getContext } from 'svelte';
  /** @type {{ title: string, avatarUrl?: string | null, showSettings?: boolean, settingsHref?: string }} */
  let { title, avatarUrl = null, showSettings = false, settingsHref = '' } = $props();
  const set = getContext('setMobileHeader');
  $effect(() => {
    set?.({ title, avatarUrl, showSettings, settingsHref });
  });
</script>

<div data-testid="child-page">page</div>
