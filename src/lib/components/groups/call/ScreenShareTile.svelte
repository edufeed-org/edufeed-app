<!--
  ScreenShareTile — one screen share on the call stage: the video, who is
  sharing, and pin / full-screen / stop controls.
-->
<script>
  import { PinIcon, ExpandIcon, CollapseIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   track: import('livekit-client').Track,
   *   label: string,
   *   isLocal?: boolean,
   *   pinned?: boolean,
   *   onTogglePin?: () => void,
   *   onStop?: () => void,
   *   compact?: boolean
   * }}
   */
  let {
    track,
    label,
    isLocal = false,
    pinned = false,
    onTogglePin = undefined,
    onStop = undefined,
    compact = false
  } = $props();

  /** @type {HTMLVideoElement | undefined} */
  let videoEl = $state(undefined);
  /** @type {HTMLDivElement | undefined} */
  let rootEl = $state(undefined);
  let isFullscreen = $state(false);

  $effect(() => {
    const el = videoEl;
    const t = track;
    if (!el || !t) return;
    t.attach(el);
    return () => t.detach(el);
  });

  function onFullscreenChange() {
    isFullscreen = !!rootEl && document.fullscreenElement === rootEl;
  }

  async function toggleFullscreen() {
    try {
      if (isFullscreen) await document.exitFullscreen();
      else await rootEl?.requestFullscreen();
    } catch (err) {
      console.warn('fullscreen refused:', err);
    }
  }
</script>

<svelte:document onfullscreenchange={onFullscreenChange} />

<div
  bind:this={rootEl}
  class="group/share relative h-full w-full overflow-hidden rounded-lg bg-black"
  data-testid="call-screen-share"
>
  <video bind:this={videoEl} autoplay playsinline muted class="h-full w-full object-contain"
  ></video>
  <div
    class="absolute right-0 bottom-0 left-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent px-2 py-1"
  >
    <span class="truncate text-xs text-white">{label}</span>
    {#if !compact}
      <div class="flex shrink-0 items-center gap-1">
        {#if onTogglePin}
          <button
            class="btn btn-circle text-white btn-ghost btn-xs"
            class:text-primary={pinned}
            aria-label={pinned ? m.groups_call_unpin() : m.groups_call_pin()}
            title={pinned ? m.groups_call_unpin() : m.groups_call_pin()}
            onclick={onTogglePin}
          >
            <PinIcon class_="h-3.5 w-3.5" title="" />
          </button>
        {/if}
        <button
          class="btn btn-circle text-white btn-ghost btn-xs"
          aria-label={isFullscreen ? m.groups_call_exit_fullscreen() : m.groups_call_fullscreen()}
          title={isFullscreen ? m.groups_call_exit_fullscreen() : m.groups_call_fullscreen()}
          onclick={toggleFullscreen}
        >
          {#if isFullscreen}
            <CollapseIcon class_="h-3.5 w-3.5" title="" />
          {:else}
            <ExpandIcon class_="h-3.5 w-3.5" title="" />
          {/if}
        </button>
        {#if isLocal && onStop}
          <button class="btn btn-sm btn-error" onclick={onStop}>
            {m.groups_call_screen_share_stop()}
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>
