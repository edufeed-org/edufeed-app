<!--
  BodyImageLicense
  Renders a license attribution + watermark badge for a body image, looked up
  by SHA-256 hash derived from the image URL (Blossom URLs only).

  Mounted dynamically by MarkdownRenderer's body-image-license action, one
  instance per <img> tag. Stays empty when no license event is reachable.
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
  <!-- Attribution caption under the image. The MarkdownRenderer action
       mounts this component directly into a <figure>, so figcaption IS a
       proper child of figure at runtime. svelte-check's static analyzer
       can't see the runtime parent. -->
  <!-- svelte-ignore a11y_figcaption_parent -->
  <figcaption class="mt-1 text-xs text-base-content/60" data-testid="body-image-license-caption">
    {label}{#if credit}
      · {credit}{/if}{#if source}
      ·
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external link -->
      <a href={source} target="_blank" rel="noopener noreferrer" class="link">source</a>{/if}
  </figcaption>
{/if}
