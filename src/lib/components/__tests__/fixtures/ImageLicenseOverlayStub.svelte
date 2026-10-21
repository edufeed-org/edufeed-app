<!-- Exposes the props CalendarEventDetailView hands to ImageLicenseOverlay so a
     test can assert the pill is wired to the image's license status. -->
<script>
  let { licenseEvent = null, status, variant = 'pill' } = $props();
</script>

<span
  data-testid="image-license-overlay-stub"
  data-status={status}
  data-variant={variant}
  data-license-id={licenseEvent?.id ?? ''}
></span>
