<script>
  // Renders the /c layout with SetMobileHeaderChild as its page.
  import Layout from '../../../../routes/c/+layout.svelte';
  import SetMobileHeaderChild from './SetMobileHeaderChild.svelte';
  /** @type {{ title: string, avatarUrl?: string | null, showSettings?: boolean, settingsHref?: string }} */
  let { title, avatarUrl = null, showSettings = false, settingsHref = '' } = $props();
</script>

<Layout>
  {#snippet children()}
    <SetMobileHeaderChild {title} {avatarUrl} {showSettings} {settingsHref} />
  {/snippet}
</Layout>
