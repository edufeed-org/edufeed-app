<!--
  NostrContentRenderer - Renders parsed Nostr event content (NAST tree)
  Handles NIP-27 mentions, NIP-30 custom emojis, links, hashtags
-->

<script>
  import { parseEventContent } from '$lib/helpers/nostrContent.js';
  import { getProxiedImageUrl } from '$lib/helpers/image-proxy.js';
  import NostrIdentifier from './NostrIdentifier.svelte';

  let { event, class: className = '', depth = 0 } = $props();

  // Use $state + $effect instead of $derived because parseEventContent
  // mutates the event object (symbol-based caching via getParsedContent)
  /** @type {any} */
  // eslint-disable-next-line svelte/prefer-writable-derived -- parseEventContent mutates event (symbol cache)
  let tree = $state(null);

  $effect(() => {
    tree = event ? parseEventContent(event) : null;
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
</script>

<div class="{className} break-words whitespace-pre-wrap">
  {#if tree}
    {#each tree.children as node, i (i)}
      {#if node.type === 'text'}
        {node.value}
      {:else if node.type === 'emoji'}
        <img
          src={getProxiedImageUrl(node.url, 'emoji') || node.url}
          alt=":{node.code}:"
          title=":{node.code}:"
          class="inline h-5 w-5 align-text-bottom"
        />
      {:else if node.type === 'mention'}
        <NostrIdentifier identifier={node.encoded} inline={true} {depth} />
      {:else if node.type === 'link'}
        {#if isImageUrl(node.href)}
          <div class="my-2 aspect-video max-h-96 overflow-hidden rounded-lg bg-base-200">
            <a href={node.href} target="_blank" rel="noopener noreferrer" class="block h-full">
              <img
                src={getProxiedImageUrl(node.href, 'content') || node.href}
                alt=""
                loading="lazy"
                class="h-full w-full object-contain"
              />
            </a>
          </div>
        {:else if isVideoUrl(node.href)}
          <div class="my-2 aspect-video max-h-96 overflow-hidden rounded-lg bg-base-200">
            <!-- svelte-ignore a11y_media_has_caption -->
            <video src={node.href} controls preload="metadata" class="h-full w-full"></video>
          </div>
        {:else}
          <a href={node.href} target="_blank" rel="noopener noreferrer" class="link link-primary"
            >{node.value}</a
          >
        {/if}
      {:else if node.type === 'hashtag'}
        <span class="text-primary">#{node.name}</span>
      {:else if node.type === 'gallery'}
        <div class="my-2 flex flex-wrap gap-2">
          {#each node.links as link, j (j)}
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              class="block aspect-square h-72 overflow-hidden rounded-lg bg-base-200"
            >
              <img
                src={getProxiedImageUrl(link, 'content') || link}
                alt=""
                loading="lazy"
                class="h-full w-full object-cover"
              />
            </a>
          {/each}
        </div>
      {/if}
    {/each}
  {/if}
</div>
