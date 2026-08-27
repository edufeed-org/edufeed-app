<!--
  ImageWithFallback Component
  Displays an image with automatic fallback on load errors
  Supports image proxy for resizing and format optimization
  Fallback chain: proxy URL → original URL → robohash (avatars only) → local placeholder
  The terminal placeholder is local (icon on bg-base-200) and can never fail;
  pass a `fallback` snippet to render something richer (e.g. an initial letter).
  All chain state derives synchronously from props, so SSR and the first client
  paint are already correct (an empty src renders the placeholder, never a bare
  <img src="">). While a source is downloading the img carries a bg-base-200
  skeleton tone that clears on load.
-->

<script>
  import { getContext } from 'svelte';
  import { getProxiedImageUrl } from '$lib/helpers/image-proxy.js';
  import {
    GROUP_MEDIA_AUTH,
    isSameMediaHost,
    fetchAuthedMediaUrl
  } from '$lib/groups/authed-media.js';
  import { PersonIcon, PeopleIcon, BadgeIcon, PhotoIcon, ArticleIcon } from '$lib/components/icons';

  /**
   * @typedef {Object} Props
   * @property {string} src - Primary image source URL
   * @property {string} alt - Alt text for accessibility
   * @property {'avatar' | 'event' | 'community' | 'banner' | 'badge' | 'article' | 'generic'} [fallbackType] - Drives the robohash stage and the placeholder icon
   * @property {boolean} [robohash] - Include the robohash stage; defaults to fallbackType === 'avatar'
   * @property {string | {w: number, h: number}} [size] - Proxy size preset or custom dimensions
   * @property {string} [class] - Additional CSS classes (applied to the img and the placeholder). Callers must provide dimension classes — the placeholder has no intrinsic size.
   * @property {'lazy' | 'eager'} [loading] - Loading attribute
   * @property {number} [width] - Intrinsic width hint, passed to the img
   * @property {number} [height] - Intrinsic height hint, passed to the img
   * @property {string} [title] - Title attribute, passed to the img
   * @property {(event: Event) => void} [onload] - Fires when the (possibly fallback) image has loaded; read natural dimensions off `event.currentTarget`
   * @property {() => void} [onexhausted] - Fires once when every source stage for the current `src` has failed, so callers that own a richer fallback (e.g. a generated cover) can take over the whole frame. Re-arms when `src` changes.
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
    onexhausted = undefined,
    fallback = undefined
  } = $props();

  const useRobohash = $derived(robohash ?? fallbackType === 'avatar');

  // Inside a group surface (GroupChat / the relay page set this context),
  // media on the group's own host is membership-gated: the anonymous proxy
  // and plain stages can only 401, so the signed Blossom fetch replaces the
  // whole chain for those URLs (see groups/authed-media.js).
  /** @type {{relay: string, getUser: () => any} | null} */
  const mediaAuth = getContext(GROUP_MEDIA_AUTH) ?? null;
  const needsAuth = $derived(!!mediaAuth && isSameMediaHost(src, mediaAuth.relay));
  /** '' while resolving, the object URL on success, null on refusal */
  /** @type {string | null} */
  let authedSrc = $state('');
  $effect(() => {
    const wanted = needsAuth ? src : null;
    authedSrc = '';
    if (!wanted || !mediaAuth) return;
    let alive = true;
    fetchAuthedMediaUrl(wanted, mediaAuth.getUser()).then((resolved) => {
      if (alive) authedSrc = resolved;
    });
    return () => {
      alive = false;
    };
  });
  const authPending = $derived(needsAuth && authedSrc === '');

  // Source stages in order: proxy URL (when distinct) → original → robohash (avatars only).
  // Derived from props so SSR and the first paint already show the right thing.
  const stages = $derived.by(() => {
    if (!src) return [];
    if (needsAuth) return authedSrc ? [authedSrc] : [];
    const list = [];
    const proxied = getProxiedImageUrl(src, size);
    if (proxied && proxied !== src) list.push(proxied);
    list.push(src);
    if (useRobohash) list.push(`https://robohash.org/${src}`);
    return list;
  });

  // How many stages have errored for the current src
  let failedStages = $state(0);
  // Whether the current source finished loading (drives the skeleton tone)
  let imageLoaded = $state(false);
  /** @type {HTMLImageElement | null} */
  let imgEl = $state(null);

  const currentSrc = $derived(stages[failedStages] ?? '');
  const exhausted = $derived(!currentSrc);

  function handleError() {
    failedStages += 1;
  }

  /** @param {Event} event */
  function handleLoad(event) {
    imageLoaded = true;
    onload?.(event);
  }

  // Reset the chain and skeleton when the src prop changes
  /** @type {any} */
  let lastSrc = Symbol('uninitialized');
  // Plain let, not $state: the notify effect writes it, and a reactive write
  // there would re-run the effect that produced it.
  let notifiedExhausted = false;
  $effect(() => {
    if (src !== lastSrc) {
      lastSrc = src;
      failedStages = 0;
      imageLoaded = false;
      notifiedExhausted = false;
    }
  });

  // Tell the caller once the whole chain is spent. An empty `src` is not a
  // failure — nothing was ever tried — and neither is an authed fetch still
  // in flight.
  $effect(() => {
    if (exhausted && !authPending && (stages.length > 0 || needsAuth) && !notifiedExhausted) {
      if (!src) return;
      notifiedExhausted = true;
      onexhausted?.();
    }
  });

  // Images that finished loading before hydration attached the load listener
  // (e.g. cached logo in SSR'd HTML) would otherwise keep the skeleton tone.
  $effect(() => {
    if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) imageLoaded = true;
  });

  const PLACEHOLDER_ICONS = {
    avatar: PersonIcon,
    community: PeopleIcon,
    badge: BadgeIcon,
    event: PhotoIcon,
    banner: PhotoIcon,
    article: ArticleIcon,
    generic: PhotoIcon
  };
  const PlaceholderIcon = $derived(
    PLACEHOLDER_ICONS[/** @type {keyof typeof PLACEHOLDER_ICONS} */ (fallbackType)] ?? PhotoIcon
  );
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
    bind:this={imgEl}
    src={currentSrc}
    {alt}
    {loading}
    {width}
    {height}
    {title}
    decoding="async"
    class="{imageLoaded ? '' : 'bg-base-200'} {className}"
    onerror={handleError}
    onload={handleLoad}
  />
{/if}
