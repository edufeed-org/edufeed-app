<!--
  HeroImage — detail-page image that NEVER crops (edufeed-app#29).

  The full picture renders at its natural ratio (object-contain, bounded
  height); a blurred, dimmed copy of the same image fills the container
  behind it, so portrait/square images letterbox gracefully instead of
  being butchered by a fixed banner crop. Cards/grids keep their uniform
  object-cover tiles — this component is for detail views.

  Clicks through to the original image (full size, incl. any attribution
  baked into it) for http(s) sources; other schemes render unlinked.
-->
<script>
  import ImageWithFallback from './ImageWithFallback.svelte';
  import { isHttpUrl } from '$lib/helpers/safeUrl.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} Props
   * @property {string} src - Image URL (untrusted event data)
   * @property {string} alt - Alt text
   * @property {string} [fallbackType] - Passed through to ImageWithFallback (API compat)
   * @property {string} [maxHeightClass] - Tailwind max-height for the foreground
   * @property {boolean} [linkToOriginal] - Wrap in a link to the original image
   * @property {import('svelte').Snippet} [children] - Overlays (e.g. license pill), positioned against the container
   */

  /** @type {Props} */
  let {
    src,
    alt,
    fallbackType = 'generic',
    maxHeightClass = 'max-h-96',
    linkToOriginal = true,
    children
  } = $props();

  const linked = $derived(linkToOriginal && isHttpUrl(src));
</script>

{#snippet picture()}
  <span class="relative block w-full overflow-hidden rounded-lg bg-base-200">
    <img
      {src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      data-testid="hero-image-backdrop"
      class="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
    />
    <ImageWithFallback
      {src}
      {alt}
      {fallbackType}
      size="hero"
      class="relative mx-auto {maxHeightClass} max-w-full object-contain"
    />
    {@render children?.()}
  </span>
{/snippet}

{#if linked}
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external: original image source -->
  <a
    href={src}
    target="_blank"
    rel="noopener noreferrer"
    class="block"
    title={m.event_detail_view_original_image()}
  >
    {@render picture()}
  </a>
{:else}
  {@render picture()}
{/if}
