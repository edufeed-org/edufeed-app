<!--
  NostrContentRenderer - Renders parsed Nostr event content (NAST tree)
  Handles NIP-27 mentions, NIP-30 custom emojis, links, hashtags
-->

<script>
  import { parseEventContent } from '$lib/helpers/nostrContent.js';
  import { parseChatMarkdown } from '$lib/helpers/chatMarkdown.js';
  import { getImetaByUrl, parseImetaDimensions } from '$lib/helpers/media-meta.js';
  import { nostrIdFromUrl, truncateMiddle, splitNostrIds } from '$lib/helpers/link-render.js';
  import * as m from '$lib/paraglide/messages';
  import NostrIdentifier from './NostrIdentifier.svelte';
  import MediaLightbox from './MediaLightbox.svelte';
  import MediaVideo from './MediaVideo.svelte';
  import ImageWithFallback from './ImageWithFallback.svelte';

  /**
   * `markdown` is opt-in and defaults off. Seven of this component's eight
   * render callers are notes, comments, DMs, previews and thread detail —
   * and ThreadDetailView deliberately gives markdown to kind 11 while
   * withholding it from kind 1 and 1111. Only chat bubbles pass it.
   */
  let { event, class: className = '', depth = 0, markdown = false } = $props();

  // Use $state + $effect instead of $derived because parseEventContent and
  // getImetaByUrl mutate the event object (symbol-based caching)
  /** @type {any} */
  let tree = $state(null);
  let md = /** @type {{ blocks: any[], nodes: any[] } | null} */ ($state(null));
  /** @type {Map<string, any>} */
  let imeta = $state(new Map());

  $effect(() => {
    tree = event && !markdown ? parseEventContent(event) : null;
    md = event && markdown ? parseChatMarkdown(event) : null;
    imeta = event ? getImetaByUrl(event) : new Map();
  });

  /**
   * Every NAST node in render order. In markdown mode the nodes live inside
   * nested blocks, so the lightbox arithmetic below runs over this flat list
   * and each markdown run carries its `offset` into it — same maths as before,
   * one more level of nesting.
   */
  const flatNodes = $derived(markdown ? (md?.nodes ?? []) : (tree?.children ?? []));

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
    for (const node of flatNodes) {
      if (node.type === 'link' && isImageUrl(node.href)) {
        out.push({ src: node.href, alt: imetaFor(node.href)?.alt });
      } else if (node.type === 'gallery') {
        for (const link of node.links) out.push({ src: link, alt: imetaFor(link)?.alt });
      }
    }
    return out;
  });

  // Flat node index → index of its first image within allImages (sparse array)
  const imageStartIndex = $derived.by(() => {
    /** @type {number[]} */
    const starts = [];
    let n = 0;
    flatNodes.forEach((/** @type {any} */ node, /** @type {number} */ i) => {
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

<!--
  The NAST node walk, shared by both paths. Plain mode renders the whole tree
  through it once at offset 0; markdown mode renders one call per inline run,
  each with its offset into `flatNodes`, so the lightbox index stays global.
  One walk means one place that can regress, not two.
-->
{#snippet nodeRun(/** @type {any[]} */ nodes, /** @type {number} */ offset)}
  {#each nodes as node, k (k)}
    {@const i = offset + k}
    {#if node.type === 'text'}
      {#each splitNostrIds(node.value) as seg, j (j)}
        {#if 'id' in seg}
          <NostrIdentifier identifier={seg.id} inline={false} {depth} />
        {:else if markdown}
          <!-- Markdown mode drops `whitespace-pre-wrap`, so line breaks are
                 emitted explicitly. Emitting both is what double-spaces lists
                 and fences. -->
          {#each seg.text.split('\n') as line, l (l)}
            {#if l > 0}<br />{/if}{line}
          {/each}
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
{/snippet}

<!-- Restricted markdown blocks. Chat only; see the `markdown` prop. -->
{#snippet blockList(/** @type {any[]} */ blocks)}
  {#each blocks as block, i (i)}
    {#if block.type === 'paragraph'}
      <p class="chat-md-p">{@render inlineList(block.children)}</p>
    {:else if block.type === 'code'}
      <pre class="my-1 overflow-x-auto rounded bg-base-300/60 p-2 text-xs text-base-content"><code
          >{block.text}</code
        ></pre>
    {:else if block.type === 'blockquote'}
      <blockquote class="my-1 border-l-2 border-current/30 pl-2 opacity-80">
        {@render blockList(block.children)}
      </blockquote>
    {:else if block.type === 'list'}
      {#if block.ordered}
        <ol class="my-1 list-decimal pl-5" start={block.start ?? undefined}>
          {#each block.items as item, j (j)}
            <li>{@render blockList(item.children)}</li>
          {/each}
        </ol>
      {:else}
        <ul class="my-1 list-disc pl-5">
          {#each block.items as item, j (j)}
            <li>{@render blockList(item.children)}</li>
          {/each}
        </ul>
      {/if}
    {/if}
  {/each}
{/snippet}

{#snippet inlineList(/** @type {any[]} */ children)}
  {#each children as child, i (i)}
    {#if child.type === 'nostr'}
      {@render nodeRun(child.nodes, child.offset)}
    {:else if child.type === 'strong'}
      <strong>{@render inlineList(child.children)}</strong>
    {:else if child.type === 'em'}
      <em>{@render inlineList(child.children)}</em>
    {:else if child.type === 'del'}
      <del>{@render inlineList(child.children)}</del>
    {:else if child.type === 'codespan'}
      <code class="rounded bg-base-300/60 px-1 py-0.5 text-xs">{child.text}</code>
    {:else if child.type === 'br'}
      <br />
    {:else if child.type === 'link'}
      <!-- href already filtered by safeHref; this path emits no {@html}, so
           there is no DOMPurify downstream to catch a bad scheme. -->
      <a href={child.href} target="_blank" rel="noopener noreferrer" class="link link-primary"
        >{@render inlineList(child.children)}</a
      >
    {/if}
  {/each}
{/snippet}

<div class="{className} break-words {markdown ? '' : 'whitespace-pre-wrap'}">
  {#if markdown}
    {@render blockList(md?.blocks ?? [])}
  {:else if tree}
    {@render nodeRun(tree.children, 0)}
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
