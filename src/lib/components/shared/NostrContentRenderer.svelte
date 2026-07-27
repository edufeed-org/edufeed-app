<!--
  NostrContentRenderer - Renders parsed Nostr event content (NAST tree)
  Handles NIP-27 mentions, NIP-30 custom emojis, links, hashtags
-->

<script>
  import { parseEventContent } from '$lib/helpers/nostrContent.js';
  import { getImetaByUrl, parseImetaDimensions } from '$lib/helpers/media-meta.js';
  import { nostrIdFromUrl, truncateMiddle, splitNostrIds } from '$lib/helpers/link-render.js';
  import * as m from '$lib/paraglide/messages';
  import NostrIdentifier from './NostrIdentifier.svelte';
  import MediaLightbox from './MediaLightbox.svelte';
  import MediaVideo from './MediaVideo.svelte';
  import ImageWithFallback from './ImageWithFallback.svelte';

  let { event, class: className = '', depth = 0 } = $props();

  // Use $state + $effect instead of $derived because parseEventContent and
  // getImetaByUrl mutate the event object (symbol-based caching)
  /** @type {any} */
  let tree = $state(null);
  /** @type {Map<string, any>} */
  let imeta = $state(new Map());

  $effect(() => {
    tree = event ? parseEventContent(event) : null;
    imeta = event ? getImetaByUrl(event) : new Map();
  });

  const imageExts = /\.(jpe?g|png|gif|webp|svg|avif|bmp)(\?.*)?$/i;
  const videoExts = /\.(mp4|webm|mov|ogg)(\?.*)?$/i;

  /** @param {string} url */
  function isImageUrl(url) {
    return imageExts.test(url);
  }

  /** @param {string} url */
  function isVideoUrl(url) {
    return videoExts.test(url);
  }

  /** NIP-92 imeta fields for a media URL, if the event carries them. @param {string} href */
  function imetaFor(href) {
    try {
      return imeta.get(new URL(href).toString());
    } catch {
      return undefined;
    }
  }

  // All post images in render order — the lightbox collection
  const allImages = $derived.by(() => {
    /** @type {Array<{ src: string, alt?: string }>} */
    const out = [];
    if (!tree) return out;
    for (const node of tree.children) {
      if (node.type === 'link' && isImageUrl(node.href)) {
        out.push({ src: node.href, alt: imetaFor(node.href)?.alt });
      } else if (node.type === 'gallery') {
        for (const link of node.links) out.push({ src: link, alt: imetaFor(link)?.alt });
      }
    }
    return out;
  });

  // Child index → index of its first image within allImages (sparse array)
  const imageStartIndex = $derived.by(() => {
    /** @type {number[]} */
    const starts = [];
    if (!tree) return starts;
    let n = 0;
    tree.children.forEach((/** @type {any} */ node, /** @type {number} */ i) => {
      if (node.type === 'link' && isImageUrl(node.href)) {
        starts[i] = n;
        n += 1;
      } else if (node.type === 'gallery') {
        starts[i] = n;
        n += node.links.length;
      }
    });
    return starts;
  });

  /** @type {{ index: number } | null} */
  let lightbox = $state(null);

  /** @param {MouseEvent} e @param {number} index */
  function openLightbox(e, index) {
    // Don't bubble into click-to-navigate host cards
    e.stopPropagation();
    lightbox = { index };
  }
</script>

<div class="{className} break-words whitespace-pre-wrap">
  {#if tree}
    {#each tree.children as node, i (i)}
      {#if node.type === 'text'}
        {#each splitNostrIds(node.value) as seg, j (j)}
          {#if 'id' in seg}
            <NostrIdentifier identifier={seg.id} inline={false} {depth} />
          {:else}
            {seg.text}
          {/if}
        {/each}
      {:else if node.type === 'emoji'}
        <ImageWithFallback
          src={node.url}
          alt=":{node.code}:"
          title=":{node.code}:"
          size="emoji"
          fallbackType="generic"
          class="inline h-5 w-5 align-text-bottom"
        />
      {:else if node.type === 'mention'}
        <NostrIdentifier identifier={node.encoded} inline={true} {depth} />
      {:else if node.type === 'link'}
        {#if isImageUrl(node.href)}
          {@const meta = imetaFor(node.href)}
          {@const dims = parseImetaDimensions(meta)}
          <div class="mt-3">
            <button
              type="button"
              data-testid="media-image"
              aria-label={m.media_image_open()}
              class="block max-w-full cursor-zoom-in p-0 text-left"
              onclick={(e) => openLightbox(e, imageStartIndex[i] ?? 0)}
            >
              <ImageWithFallback
                src={node.href}
                alt={meta?.alt || ''}
                loading="lazy"
                width={dims?.width}
                height={dims?.height}
                size="content"
                fallbackType="generic"
                class="block h-auto max-h-[480px] w-auto max-w-full rounded-xl"
              />
            </button>
          </div>
        {:else if isVideoUrl(node.href)}
          {@const meta = imetaFor(node.href)}
          {@const dims = parseImetaDimensions(meta)}
          <div class="mt-3">
            <MediaVideo
              src={node.href}
              poster={meta?.image || meta?.thumbnail}
              width={dims?.width}
              height={dims?.height}
            />
          </div>
        {:else if nostrIdFromUrl(node.href)}
          <NostrIdentifier identifier={nostrIdFromUrl(node.href)} inline={false} {depth} />
        {:else}
          <a
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            class="link link-primary"
            title={node.value}>{truncateMiddle(node.value)}</a
          >
        {/if}
      {:else if node.type === 'hashtag'}
        <span class="text-primary">#{node.name}</span>
      {:else if node.type === 'gallery'}
        {@const start = imageStartIndex[i] ?? 0}
        {@const count = node.links.length}
        <div
          data-testid="media-gallery"
          class="mt-3 grid h-[340px] grid-cols-2 gap-1.5 overflow-hidden rounded-xl {count > 2
            ? 'grid-rows-2'
            : ''}"
        >
          {#each node.links.slice(0, 4) as link, j (j)}
            <button
              type="button"
              data-testid="media-gallery-item"
              aria-label={m.media_image_open()}
              class="relative block h-full w-full cursor-zoom-in overflow-hidden p-0 {count === 3 &&
              j === 0
                ? 'row-span-2'
                : ''}"
              onclick={(e) => openLightbox(e, start + j)}
            >
              <ImageWithFallback
                src={link}
                alt={imetaFor(link)?.alt || ''}
                loading="lazy"
                size="content"
                fallbackType="generic"
                class="h-full w-full object-cover"
              />
              {#if j === 3 && count > 4}
                <span
                  data-testid="media-gallery-more"
                  class="absolute inset-0 grid place-items-center bg-black/50 text-lg font-semibold text-white"
                  >+{count - 4}</span
                >
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    {/each}
  {/if}

  {#if lightbox}
    <MediaLightbox
      items={allImages}
      startIndex={lightbox.index}
      onclose={() => (lightbox = null)}
    />
  {/if}
</div>

<style>
  /*
   * Inside a primary chat bubble the background is `--color-primary`, so
   * `.link-primary` / `.text-primary` (also primary) become invisible. Flip
   * them to `primary-content` (the on-primary foreground) for contrast.
   */
  :global(.chat-bubble-primary .link-primary),
  :global(.chat-bubble-primary .text-primary) {
    color: var(--color-primary-content);
  }

  /*
   * ...but NOT inside embedded preview cards (.nostr-preview-surface), which
   * paint their own opaque base-100 background — there primary-content would
   * be white-on-white, so restore the normal primary color.
   */
  :global(.chat-bubble-primary .nostr-preview-surface .link-primary),
  :global(.chat-bubble-primary .nostr-preview-surface .text-primary) {
    color: var(--color-primary);
  }
</style>
