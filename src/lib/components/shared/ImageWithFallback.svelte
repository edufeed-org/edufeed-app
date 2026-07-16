<!--
  ImageWithFallback Component
  Displays an image with automatic fallback on load errors
  Supports image proxy for resizing and format optimization
  Fallback chain: proxy URL → original URL → robohash (avatars only) → local placeholder
  The terminal placeholder is local (icon on bg-base-200) and can never fail;
  pass a `fallback` snippet to render something richer (e.g. an initial letter).
-->

<script>
  import { getProxiedImageUrl } from '$lib/helpers/image-proxy.js';
  import { PersonIcon, PeopleIcon, BadgeIcon, PhotoIcon } from '$lib/components/icons';

  /**
   * @typedef {Object} Props
   * @property {string} src - Primary image source URL
   * @property {string} alt - Alt text for accessibility
   * @property {'avatar' | 'event' | 'community' | 'banner' | 'badge' | 'generic'} [fallbackType] - Drives the robohash stage and the placeholder icon
   * @property {boolean} [robohash] - Include the robohash stage; defaults to fallbackType === 'avatar'
   * @property {string | {w: number, h: number}} [size] - Proxy size preset or custom dimensions
   * @property {string} [class] - Additional CSS classes (applied to the img and the placeholder)
   * @property {'lazy' | 'eager'} [loading] - Loading attribute
   * @property {number} [width] - Intrinsic width hint, passed to the img
   * @property {number} [height] - Intrinsic height hint, passed to the img
   * @property {string} [title] - Title attribute, passed to the img
   * @property {(event: Event) => void} [onload] - Fires when the (possibly fallback) image has loaded; read natural dimensions off `event.currentTarget`
   * @property {import('svelte').Snippet} [fallback] - Rendered when every source stage fails
   */

  let {
    src,
    alt,
    fallbackType = 'generic',
    robohash = undefined,
    size = undefined,
    class: className = '',
    loading = /** @type {'lazy' | 'eager'} */ ('lazy'),
    width = undefined,
    height = undefined,
    title = undefined,
    onload = undefined,
    fallback = undefined
  } = $props();

  const useRobohash = $derived(robohash ?? fallbackType === 'avatar');

  // Track current image source (primary or fallback)
  let currentSrc = $state('');
  // All source stages failed → render the local placeholder
  let exhausted = $state(false);

  // 0 = proxy, 1 = original, 2 = robohash
  let fallbackStage = 0;

  // Track initialized src to detect prop changes
  /** @type {any} */
  let initializedSrc = Symbol('uninitialized');

  function handleError() {
    if (fallbackStage === 0) {
      // Proxy failed → try original URL
      fallbackStage = 1;
      currentSrc = src;
    } else if (fallbackStage === 1 && useRobohash) {
      // Compute robohash URL inline (no $derived) so this handler is safe
      // to fire after the owning $effect has been destroyed.
      fallbackStage = 2;
      currentSrc = `https://robohash.org/${src}`;
    } else {
      exhausted = true;
    }
  }

  // Initialize and reset when src or size changes
  $effect(() => {
    const proxied = getProxiedImageUrl(src, size);
    const effectiveSrc = proxied || src;
    // Only reset if the base src changed
    if (src !== initializedSrc) {
      // If proxy produced a different URL, start at stage 0
      fallbackStage = effectiveSrc !== src ? 0 : 1;
      currentSrc = effectiveSrc || '';
      exhausted = !src;
      initializedSrc = src;
    }
  });

  const PLACEHOLDER_ICONS = {
    avatar: PersonIcon,
    community: PeopleIcon,
    badge: BadgeIcon,
    event: PhotoIcon,
    banner: PhotoIcon,
    generic: PhotoIcon
  };
  const PlaceholderIcon = $derived(PLACEHOLDER_ICONS[fallbackType] ?? PhotoIcon);
</script>

{#if exhausted}
  {#if fallback}
    {@render fallback()}
  {:else}
    <div
      class="inline-flex items-center justify-center overflow-hidden bg-base-200 text-base-content/30 {className}"
      role="img"
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      data-testid="image-fallback-placeholder"
    >
      <PlaceholderIcon class_="h-1/2 max-h-8 w-1/2 max-w-8" title="" />
    </div>
  {/if}
{:else}
  <img
    src={currentSrc}
    {alt}
    {loading}
    {width}
    {height}
    {title}
    decoding="async"
    class={className}
    onerror={handleError}
    {onload}
  />
{/if}
