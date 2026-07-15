<!--
  ImageWithFallback Component
  Displays an image with automatic fallback on load errors
  Supports image proxy for resizing and format optimization
  Fallback chain: proxy URL → original URL → robohash
-->

<script>
  import { getProxiedImageUrl } from '$lib/helpers/image-proxy.js';

  /**
   * @typedef {Object} Props
   * @property {string} src - Primary image source URL
   * @property {string} alt - Alt text for accessibility
   * @property {'avatar' | 'event' | 'community' | 'banner' | 'generic'} [fallbackType] - Type of fallback image (kept for API compat)
   * @property {string | {w: number, h: number}} [size] - Proxy size preset or custom dimensions
   * @property {string} [class] - Additional CSS classes
   * @property {'lazy' | 'eager'} [loading] - Loading attribute
   * @property {(event: Event) => void} [onload] - Fires when the (possibly fallback) image has loaded; read natural dimensions off `event.currentTarget`
   */

  let {
    src,
    alt,
    fallbackType: _fallbackType = 'generic',
    size = undefined,
    class: className = '',
    loading = /** @type {'lazy' | 'eager'} */ ('lazy'),
    onload = undefined
  } = $props();

  // Track current image source (primary or fallback)
  let currentSrc = $state('');

  // 0 = proxy, 1 = original, 2 = robohash
  let fallbackStage = 0;

  // Track initialized src to detect prop changes
  let initializedSrc = '';

  function handleError() {
    if (fallbackStage === 0) {
      // Proxy failed → try original URL
      fallbackStage = 1;
      currentSrc = src;
    } else if (fallbackStage === 1) {
      // Original failed → robohash
      // Compute robohash URL inline (no $derived) so this handler is safe
      // to fire after the owning $effect has been destroyed.
      fallbackStage = 2;
      currentSrc = `https://robohash.org/${src}`;
    }
    // Stage 2 (robohash) failed → nothing more to try
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
      initializedSrc = src;
    }
  });
</script>

<img
  src={currentSrc}
  {alt}
  {loading}
  decoding="async"
  class={className}
  onerror={handleError}
  {onload}
/>
