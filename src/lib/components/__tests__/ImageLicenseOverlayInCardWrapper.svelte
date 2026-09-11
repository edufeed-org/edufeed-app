<!--
  Test wrapper: an ImageLicenseOverlay inside a clickable "card" with Svelte
  (delegated) click/keydown handlers, mirroring AMBResourceCard & friends.
-->
<script>
  import ImageLicenseOverlay from '../shared/ImageLicenseOverlay.svelte';

  /** @type {{ licenseEvent: any, onCardClick: () => void, onCardKeydown: () => void }} */
  let { licenseEvent, onCardClick, onCardKeydown } = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div data-testid="card" onclick={onCardClick} onkeydown={onCardKeydown}>
  <ImageLicenseOverlay {licenseEvent} status="found" />
</div>
