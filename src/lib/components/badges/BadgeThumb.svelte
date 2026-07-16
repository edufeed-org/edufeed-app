<!--
  BadgeThumb — small badge thumbnail with a gradient/icon placeholder when no image is set.

  Used while the kind 30009 badge definition is still loading (after the slot has been
  extracted from the user's profile_badges event), and as a permanent fallback when a
  badge definition has no image.

  Pass `class` to control size + shape (e.g. "h-8 w-8 rounded-lg border-2 ...").
-->
<script>
  import ImageWithFallback from '../shared/ImageWithFallback.svelte';

  /**
   * @typedef {Object} Props
   * @property {string} [thumb] - Preferred image (small)
   * @property {string} [image] - Fallback image (larger)
   * @property {string} [alt]
   * @property {string} [class] - Layout/border/shape classes applied to both image and placeholder
   */

  /** @type {Props} */
  let { thumb = '', image = '', alt = 'Badge', class: className = '' } = $props();

  const src = $derived(thumb || image);
</script>

{#snippet placeholder()}
  <div
    class="flex items-center justify-center bg-gradient-to-br from-primary/30 to-secondary/30 {className}"
    aria-label={alt}
  >
    <svg
      class="h-1/2 w-1/2 text-primary/60"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      stroke-width="2"
    >
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89L17 22l-5-3l-5 3l1.523-9.11" />
    </svg>
  </div>
{/snippet}

{#if src}
  <ImageWithFallback
    {src}
    {alt}
    fallbackType="badge"
    class="object-cover {className}"
    fallback={placeholder}
  />
{:else}
  {@render placeholder()}
{/if}
