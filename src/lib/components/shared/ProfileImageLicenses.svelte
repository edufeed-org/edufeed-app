<script>
  /**
   * ProfileImageLicenses — the kind-1063 attestations of a profile's picture
   * and banner, as a row of license badges under the identity block.
   *
   * Uploads through AvatarUploader / BannerUploader / LicensedImageInput mint
   * a license event like every other upload, but no profile surface showed it
   * (issue 1ff3b524). A 56 px avatar has no room for the overlay pill, so the
   * badges sit in a row beside the identity instead, each labelled with the
   * image it belongs to.
   *
   * Only Blossom URLs carry a hash to look up; a picture that resolves to no
   * attestation renders NOTHING — the "Keine Lizenzangabe" caution would sit
   * on every robohash fallback and every externally hosted avatar.
   */
  import { getSha256FromURL } from 'applesauce-common/helpers';
  import { useLicenseStatus } from '$lib/stores/image-license.svelte.js';
  import ImageLicenseOverlay from './ImageLicenseOverlay.svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    /** @type {string | null | undefined} */ picture = null,
    /** @type {string | null | undefined} */ banner = null,
    class: className = ''
  } = $props();

  /** @param {string | null | undefined} url */
  function hashOf(url) {
    if (!url) return null;
    try {
      return getSha256FromURL(url) ?? null;
    } catch {
      return null;
    }
  }

  const pictureHash = $derived(hashOf(picture));
  const bannerHash = $derived(hashOf(banner));
  const getPictureStatus = useLicenseStatus(() => pictureHash);
  const getBannerStatus = useLicenseStatus(() => bannerHash);

  const entries = $derived(
    [
      { key: 'picture', ...getPictureStatus() },
      { key: 'banner', ...getBannerStatus() }
    ].filter((entry) => entry.status === 'found' && entry.event)
  );
</script>

{#if entries.length > 0}
  <div
    class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/60 {className}"
    data-testid="profile-image-licenses"
  >
    {#each entries as entry (entry.key)}
      <!-- min-w-0 / max-w-full keep the shrink chain intact so the pill's credit
           truncates instead of running past a narrow hero's edge. -->
      <span
        class="inline-flex max-w-full min-w-0 items-center gap-1"
        data-testid="profile-image-license-entry"
      >
        <span class="shrink-0"
          >{entry.key === 'picture'
            ? m.profile_image_license_picture()
            : m.profile_image_license_banner()}:</span
        >
        <ImageLicenseOverlay
          licenseEvent={entry.event}
          status="found"
          variant="pill"
          position="relative"
        />
      </span>
    {/each}
  </div>
{/if}
