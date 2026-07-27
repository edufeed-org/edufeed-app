<!--
  MediaVideo — click-to-play video for feed post content.

  Before play: poster frame (NIP-92 imeta poster when available, otherwise the
  video's own first frame via preload="metadata") with a centered play button
  and a duration badge once metadata is known. Clicking swaps in the native
  player with controls and autoplay. Sized like single images: left-aligned at
  natural size, capped at 480px height, never letterboxed.
-->

<script>
  import * as m from '$lib/paraglide/messages';
  import { getProxiedImageUrl } from '$lib/helpers/image-proxy.js';
  import { formatMediaDuration } from '$lib/helpers/media-meta.js';

  /** @type {{ src: string, poster?: string, width?: number, height?: number }} */
  let { src, poster = undefined, width = undefined, height = undefined } = $props();

  let playing = $state(false);
  /** @type {number | undefined} */
  let duration = $state(undefined);
  const durationLabel = $derived(
    duration !== undefined ? formatMediaDuration(duration) : undefined
  );
</script>

{#if playing}
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    data-testid="media-video-player"
    {src}
    controls
    autoplay
    {width}
    {height}
    class="block h-auto max-h-[480px] w-auto max-w-full rounded-xl"
  ></video>
{:else}
  <div
    data-testid="media-video"
    class="relative inline-block max-w-full overflow-hidden rounded-xl leading-none"
  >
    <video
      {src}
      poster={poster ? getProxiedImageUrl(poster, 'content') || poster : undefined}
      preload="metadata"
      muted
      playsinline
      {width}
      {height}
      class="pointer-events-none block h-auto max-h-[480px] w-auto max-w-full"
      onloadedmetadata={(e) => (duration = e.currentTarget.duration)}
    ></video>
    <button
      type="button"
      data-testid="media-video-play"
      aria-label={m.media_video_play()}
      class="absolute inset-0 grid w-full cursor-pointer place-items-center bg-black/10"
      onclick={(e) => {
        e.stopPropagation();
        playing = true;
      }}
    >
      <span
        class="grid h-14 w-14 place-items-center rounded-full bg-[rgb(20_18_14/0.72)] text-white backdrop-blur-sm transition-transform hover:scale-105"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"
          ><path d="M8 5.5v13l11-6.5z" /></svg
        >
      </span>
    </button>
    {#if durationLabel}
      <span
        data-testid="media-video-duration"
        class="absolute right-2.5 bottom-2.5 rounded-md bg-[rgb(20_18_14/0.72)] px-1.5 py-1 font-mono text-[11px] font-semibold text-white"
        >{durationLabel}</span
      >
    {/if}
  </div>
{/if}
