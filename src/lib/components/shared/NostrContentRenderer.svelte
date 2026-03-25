<!--
  NostrContentRenderer - Renders parsed Nostr event content (NAST tree)
  Handles NIP-27 mentions, NIP-30 custom emojis, links, hashtags
-->

<script>
  import { parseEventContent } from '$lib/helpers/nostrContent.js';
  import NostrIdentifier from './NostrIdentifier.svelte';

  let { event, class: className = '' } = $props();

  let tree = $derived(event ? parseEventContent(event) : null);

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
          src={node.url}
          alt=":{node.code}:"
          title=":{node.code}:"
          class="inline h-5 w-5 align-text-bottom"
        />
      {:else if node.type === 'mention'}
        <NostrIdentifier identifier={node.encoded} inline={true} />
      {:else if node.type === 'link'}
        {#if isImageUrl(node.href)}
          <a href={node.href} target="_blank" rel="noopener noreferrer">
            <img src={node.href} alt="" loading="lazy" class="my-2 max-h-96 rounded-lg" />
          </a>
        {:else if isVideoUrl(node.href)}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={node.href} controls preload="metadata" class="my-2 max-h-96 rounded-lg"
          ></video>
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
            <a href={link} target="_blank" rel="noopener noreferrer">
              <img src={link} alt="" loading="lazy" class="max-h-72 rounded-lg" />
            </a>
          {/each}
        </div>
      {/if}
    {/each}
  {/if}
</div>
