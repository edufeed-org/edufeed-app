<!--
  BodyImageLicense
  Renders a license watermark badge for a body image, looked up by SHA-256
  hash derived from the image URL (Blossom URLs only).

  Mounted dynamically by MarkdownRenderer's body-image-license action, one
  instance per <img> tag. Stays empty when no license event is reachable.

  This component renders ONLY the watermark overlay. The full TULLU
  attribution is inserted by MarkdownEditor into the raw markdown text
  immediately after the image at upload time (see buildTulluCaption), so it
  travels with the content and is editable by the author. The watermark
  here is a discoverability hint for body images that didn't get the
  inline caption (e.g., legacy content, external Blossom URLs).
-->

<script>
  import { getSha256FromURL } from 'applesauce-common/helpers';
  import { useLicenseForHash } from '$lib/stores/image-license.svelte.js';
  import { formatLicenseUrl } from '$lib/helpers/educational/licenseLabel.js';

  let { src = '' } = $props();

  const hash = $derived.by(() => {
    if (!src) return null;
    try {
      return getSha256FromURL(src) ?? null;
    } catch {
      return null;
    }
  });

  const getLicense = useLicenseForHash(() => hash);
  const license = $derived(getLicense());

  const licenseUrl = $derived(
    license?.tags.find(/** @param {string[]} t */ (t) => t[0] === 'license')?.[1] ?? null
  );
  const credit = $derived(
    license?.tags.find(/** @param {string[]} t */ (t) => t[0] === 'credit')?.[1] ?? null
  );
  const source = $derived(
    license?.tags.find(/** @param {string[]} t */ (t) => t[0] === 'source')?.[1] ?? null
  );

  const label = $derived(licenseUrl ? formatLicenseUrl(licenseUrl) : null);
</script>

{#if license && label}
  <!-- Watermark overlay; the action wraps the <img> in a relative <figure> so this anchors correctly -->
  <span
    class="absolute right-1 bottom-1 badge gap-1 badge-ghost bg-base-100/80 text-xs backdrop-blur"
    title={[credit ? `Credit: ${credit}` : null, source ? `Source: ${source}` : null]
      .filter(Boolean)
      .join('\n')}
    data-testid="body-image-license-watermark"
  >
    <span class="font-medium">{label}</span>
    {#if credit}<span class="opacity-70">· {credit}</span>{/if}
  </span>
{/if}
