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
  import ImageLicenseOverlay from '$lib/components/shared/ImageLicenseOverlay.svelte';
  import TypoCover from './TypoCover.svelte';
  import { useLicenseStatus } from '$lib/stores/image-license.svelte.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { getLabelsWithFallback } from '$lib/helpers/educational/ambTransform.js';
  import { getCoverHue } from '$lib/helpers/educational/coverColor.js';
  import {
    canDeriveThumbnail,
    getThumbnailSourceUrl,
    pdfThumbnailEndpoint
  } from '$lib/helpers/educational/pdfThumbnailGate.js';
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
  const getLicenseStatus = useLicenseStatus(() => imageHash);
  const licenseStatus = $derived(getLicenseStatus());
  const cautionVariant = $derived(size === 'thumbnail' ? 'dot' : 'pill');

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

  // App-derived PDF page-1 thumbnail (issue #24): used only when the user
  // set no cover image, gated by the rights policy (open license or attested
  // upload). Never written to the event — /api/pdf-thumbnail renders+caches.
  let thumbFailed = $state(false);
  const pdfThumbUrl = $derived.by(() => {
    if (resource?.image || thumbFailed) return null;
    if (!canDeriveThumbnail(resource?.tags)) return null;
    const src = getThumbnailSourceUrl(resource?.tags);
    return src ? pdfThumbnailEndpoint(src) : null;
  });

  const paletteId = $derived(resource?.identifier ?? '');
  const coverHue = $derived(getCoverHue(resource));
  const title = $derived(resource?.name ?? '');

  // Author attribution for the CC BY footer line.
  // Prefers the resource's own creator:name tags (the *actual* author of the
  // metadata, e.g. "Constanze von Kitzing") over the Nostr publisher.
  // Falls back to the publisher profile's display name, then a shortened pubkey.
  // The display order matters: the first author is the primary attribution.
  const creatorNames = $derived(
    (resource?.tags ?? [])
      .filter((/** @type {string[]} */ t) => t[0] === 'creator:name')
      .map((/** @type {string[]} */ t) => t[1])
      .filter(Boolean)
  );
  const publisherProfile = useUserProfile(() => resource?.pubkey);
  const authors = $derived.by(() => {
    if (creatorNames.length > 0) return creatorNames;
    const profile = publisherProfile();
    if (profile) {
      const name = getDisplayName(profile, '');
      if (name) return [name];
    }
    if (resource?.pubkey) return [resource.pubkey.slice(0, 8) + '…'];
    return [];
  });
  const licenseLabel = $derived(resource?.license?.label ?? null);
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
    <ImageLicenseOverlay
      licenseEvent={licenseStatus.event}
      status={licenseStatus.status}
      variant={cautionVariant}
      position="absolute right-1 bottom-1 bg-base-100/80 backdrop-blur"
    />
  </div>
{:else if pdfThumbUrl}
  <div
    class="resource-cover-pdf-thumb relative w-full overflow-hidden rounded-lg bg-base-200 {aspectClass} {className}"
    data-testid="resource-cover-pdf-thumb"
  >
    <img
      src={pdfThumbUrl}
      alt={title}
      loading="lazy"
      class="h-full w-full object-cover object-top"
      onerror={() => (thumbFailed = true)}
    />
  </div>
{:else}
  <div
    class="resource-cover-typo {size === 'full'
      ? 'mx-auto w-full max-w-[280px]'
      : 'w-full'} {className}"
    data-testid="resource-cover-typo"
  >
    <TypoCover
      {title}
      {contentTypeLabel}
      {metaLabel}
      {authors}
      {licenseLabel}
      {paletteId}
      hueOverride={coverHue}
      {size}
    />
  </div>
{/if}
