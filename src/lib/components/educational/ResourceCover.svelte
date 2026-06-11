<!--
  ResourceCover — resource-aware wrapper.

  - If resource.image is present: renders <ImageWithFallback> + license badge
    at the caller-specified aspect ratio. NO change to existing image behavior.
  - If resource.image is missing: renders <TypoCover> at 3:4 portrait,
    capped by a max-width to prevent the cover from dominating the layout.

  This is the only file that knows about the AMB resource shape, i18n label
  resolution, and the license-event lookup. After migration, callers should
  not import useLicenseForHash for thumbnail purposes.

  Per docs/superpowers/specs/2026-06-11-typo-cover-design.md.
-->
<script>
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import LicenseBadge from '$lib/components/shared/LicenseBadge.svelte';
  import TypoCover from './TypoCover.svelte';
  import { useLicenseForHash } from '$lib/stores/image-license.svelte.js';
  import { getLabelsWithFallback } from '$lib/helpers/educational/ambTransform.js';
  import { getCachedConcepts, ensureVocabularyLoaded } from '$lib/stores/skos-cache.svelte.js';
  import { getLocale } from '$lib/paraglide/runtime.js';

  /**
   * @typedef {Object} Props
   * @property {any} resource — AMB resource (same shape AMBResourceCard consumes)
   * @property {'thumbnail' | 'full'} [size]
   * @property {'auto' | 'square' | 'video' | 'wide' | 'portrait'} [aspect]
   * @property {string} [class]
   */

  /** @type {Props} */
  let { resource, size = 'full', aspect = 'wide', class: className = '' } = $props();

  // Trigger SKOS cache load so concept labels resolve when present.
  ensureVocabularyLoaded('learningResourceType');

  // Aspect class map for the image branch. 'auto' = no aspect class.
  const ASPECT_CLASS = /** @type {Record<string, string>} */ ({
    auto: '',
    square: 'aspect-square',
    video: 'aspect-video',
    wide: 'aspect-[2/1]',
    portrait: 'aspect-[3/4]'
  });

  const aspectClass = $derived(ASPECT_CLASS[aspect] ?? '');

  // License-badge centralization: lookup the kind-1063 license event for the
  // image's SHA-256 hash (if the resource carries an `x` tag).
  const imageHash = $derived(
    resource?.tags?.find((/** @type {string[]} */ t) => t[0] === 'x')?.[1] ?? null
  );
  const getImageLicense = useLicenseForHash(() => imageHash);
  const licenseEvent = $derived(getImageLicense());

  // Locale-aware label derivation for the typo branch. Same paths used by
  // AMBResourceCard for consistency.
  const resourceTypeConcepts = $derived(getCachedConcepts('learningResourceType'));
  const localizedTypes = $derived(
    getLabelsWithFallback(
      resource?.tags ?? [],
      'learningResourceType',
      getLocale(),
      resourceTypeConcepts
    )
  );
  const localizedLevels = $derived(
    getLabelsWithFallback(resource?.tags ?? [], 'educationalLevel', getLocale())
  );
  const localizedAudience = $derived(
    getLabelsWithFallback(resource?.tags ?? [], 'audience', getLocale())
  );

  const contentTypeLabel = $derived(
    localizedTypes[0]?.label ? localizedTypes[0].label.toUpperCase() : null
  );
  const metaLabel = $derived(
    localizedLevels[0]?.label
      ? localizedLevels[0].label.toUpperCase()
      : localizedAudience[0]?.label
        ? localizedAudience[0].label.toUpperCase()
        : null
  );

  const paletteId = $derived(resource?.identifier ?? '');
  const title = $derived(resource?.name ?? '');
</script>

{#if resource?.image}
  <div
    class="resource-cover-image relative w-full overflow-hidden rounded-lg bg-base-200 {aspectClass} {className}"
    data-testid="resource-cover-image"
  >
    <ImageWithFallback
      src={resource.image}
      alt={title}
      fallbackType="article"
      size={size === 'thumbnail' ? 'thumbnail' : 'card'}
      class="h-full w-full object-cover"
    />
    {#if licenseEvent}
      <LicenseBadge {licenseEvent} class="absolute right-1 bottom-1 bg-base-100/80 backdrop-blur" />
    {/if}
  </div>
{:else}
  <div
    class="resource-cover-typo {size === 'full'
      ? 'mx-auto w-full max-w-[280px]'
      : 'w-full'} {className}"
    data-testid="resource-cover-typo"
  >
    <TypoCover {title} {contentTypeLabel} {metaLabel} {paletteId} {size} />
  </div>
{/if}
