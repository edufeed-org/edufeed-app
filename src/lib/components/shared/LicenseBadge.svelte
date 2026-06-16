<!--
  LicenseBadge — thin wrapper kept for existing call sites. Renders the
  known-license badge via ImageLicenseOverlay (status="found"). The `class`
  prop is forwarded as the overlay's positioning/background classes.
-->
<script>
  import ImageLicenseOverlay from './ImageLicenseOverlay.svelte';

  let { licenseEvent = null, class: klass = '' } = $props();
</script>

<ImageLicenseOverlay {licenseEvent} status="found" position={klass} />
