<!--
  BodyImageLicense
  License overlay for a body image, looked up by SHA-256 hash derived from the
  image URL (Blossom URLs only). Shows the known-license badge when found, and a
  friendly "license unknown" caution when missing. Mounted dynamically by
  MarkdownRenderer's body-image-license action, one instance per <img>.
-->
<script>
  import { getSha256FromURL } from 'applesauce-common/helpers';
  import { useLicenseStatus } from '$lib/stores/image-license.svelte.js';
  import ImageLicenseOverlay from './ImageLicenseOverlay.svelte';

  let { src = '' } = $props();

  const hash = $derived.by(() => {
    if (!src) return null;
    try {
      return getSha256FromURL(src) ?? null;
    } catch {
      return null;
    }
  });

  const getStatus = useLicenseStatus(() => hash);
  const licenseStatus = $derived(getStatus());
</script>

<ImageLicenseOverlay
  licenseEvent={licenseStatus.event}
  status={licenseStatus.status}
  variant="pill"
  position="absolute right-1 bottom-1 bg-base-100/80 backdrop-blur"
/>
