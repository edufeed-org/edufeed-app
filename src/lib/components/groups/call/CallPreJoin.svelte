<!--
  CallPreJoin — the lobby before a call: a self-preview of the camera, a
  microphone level meter, device pickers and the "join with camera / mic"
  toggles. Local tracks only (services/call-preview): no Room, no token,
  nothing sent — the token is requested when the parent's onJoin runs.

  Hosted inline on the guest landing page (CallLanding) and in the member
  pre-join modal (CallPreJoinModal, asked by joinGroupCallWithConfirm). The
  parent brings the join button's label, any extra fields (the guest's name)
  through `children`, and the join error to show. Loaded lazily everywhere:
  the preview service imports livekit-client.
-->
<script>
  import { untrack } from 'svelte';
  import {
    getCallPreviewState,
    setPreviewCamera,
    setPreviewMic,
    switchPreviewDevice,
    refreshPreviewDevices,
    stopPreview
  } from '$lib/services/call-preview.svelte.js';
  import { getJoinMedia, setJoinMedia } from '$lib/services/call-prefs.js';
  import { callMediaErrorMessage } from '$lib/groups/call-media-errors.js';
  import { MicIcon, MicOffIcon, VideoIcon, VideoOffIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   joinLabel: string,
   *   onJoin: (media: {audio: boolean, video: boolean}) => void | Promise<void>,
   *   onCancel?: () => void,
   *   busy?: boolean,
   *   error?: string | null,
   *   testid?: string,
   *   children?: import('svelte').Snippet
   * }}
   * `testid`: the join button's test id — the parent's surface keeps its own
   * name for "the join button" (same convention as CallUnreadDot).
   */
  let {
    joinLabel,
    onJoin,
    onCancel = undefined,
    busy = false,
    error = null,
    testid = 'call-prejoin-join',
    children = undefined
  } = $props();

  const pv = getCallPreviewState();
  // Remembered per device; the toggles drive the preview and the join.
  let media = $state(getJoinMedia());
  let joining = $state(false);
  /** @type {HTMLVideoElement | undefined} */
  let videoEl = $state(undefined);
  let destroyed = false;

  // The preview follows the toggles; everything is released on unmount.
  // Untracked calls: the service writes its own $state.
  $effect(() => {
    const on = media.video;
    untrack(() => setPreviewCamera(on));
  });
  $effect(() => {
    const on = media.audio;
    untrack(() => setPreviewMic(on));
  });
  $effect(() => {
    untrack(() => refreshPreviewDevices());
    return () => {
      destroyed = true;
      stopPreview();
    };
  });
  $effect(() => {
    const track = pv.videoTrack;
    const el = videoEl;
    if (!track || !el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  });

  // A capture the browser refused turns its toggle back off, with the reason.
  const cameraHint = $derived(
    pv.cameraError ? callMediaErrorMessage(pv.cameraError, 'camera') : ''
  );
  const micHint = $derived(pv.micError ? callMediaErrorMessage(pv.micError, 'mic') : '');
  $effect(() => {
    if (pv.cameraError) media.video = false;
  });
  $effect(() => {
    if (pv.micError) media.audio = false;
  });

  const speakerSelectable =
    typeof globalThis !== 'undefined' &&
    typeof /** @type {any} */ (globalThis).AudioContext?.prototype?.setSinkId === 'function';
  // calculateVolume is an RMS-ish 0..1 that rarely passes 0.3 for speech.
  const levelPercent = $derived(Math.min(100, Math.round(pv.level * 300)));

  async function join() {
    if (joining || busy) return;
    joining = true;
    const chosen = { audio: media.audio, video: media.video };
    setJoinMedia(chosen);
    // Release the devices first: the Room captures them itself, and two
    // captures of one camera fail on some phones.
    stopPreview();
    try {
      await onJoin(chosen);
    } catch (err) {
      // The parent reports its own join failures (error prop / its view);
      // nothing here to add, and a click handler must not reject.
      console.warn('call join failed:', err);
    } finally {
      joining = false;
      // Still here (the join failed): bring the preview back.
      if (!destroyed) {
        if (chosen.video) setPreviewCamera(true);
        if (chosen.audio) setPreviewMic(true);
      }
    }
  }
</script>

<!-- A form: Enter in a field the parent adds (the guest's name) joins. -->
<form
  class="flex flex-col gap-3"
  data-testid="call-prejoin"
  onsubmit={(e) => {
    e.preventDefault();
    join();
  }}
>
  <div
    class="relative aspect-video w-full overflow-hidden rounded-box bg-neutral text-neutral-content"
    data-testid="call-prejoin-preview"
  >
    {#if pv.videoTrack}
      <video
        bind:this={videoEl}
        class="h-full w-full -scale-x-100 object-cover"
        autoplay
        muted
        playsinline
        data-testid="call-prejoin-video"
      ></video>
    {:else}
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm">
        {#if pv.cameraStarting}
          <span class="loading loading-md loading-spinner"></span>
        {:else}
          <VideoOffIcon class_="h-8 w-8 opacity-70" title="" />
          <span class="opacity-70">{m.groups_call_prejoin_camera_off()}</span>
        {/if}
      </div>
    {/if}
  </div>

  <div class="flex flex-col gap-2">
    <label class="flex cursor-pointer items-center justify-between gap-3 text-sm">
      <span class="flex items-center gap-2">
        {#if media.audio}
          <MicIcon class_="h-4 w-4" title="" />
        {:else}
          <MicOffIcon class_="h-4 w-4" title="" />
        {/if}
        {m.groups_call_prejoin_mic_toggle()}
      </span>
      <input
        type="checkbox"
        class="toggle toggle-primary toggle-sm"
        bind:checked={media.audio}
        disabled={pv.micStarting}
        data-testid="call-prejoin-mic"
      />
    </label>
    <div
      class="h-1.5 w-full overflow-hidden rounded-full bg-base-300"
      role="meter"
      aria-label={m.groups_call_prejoin_mic_level()}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={levelPercent}
      data-testid="call-prejoin-level"
    >
      <div
        class="h-full rounded-full bg-success transition-[width] duration-75"
        style="width: {media.audio ? levelPercent : 0}%"
      ></div>
    </div>
    {#if micHint}<p class="text-xs text-error" data-testid="call-prejoin-mic-error">
        {micHint}
      </p>{/if}

    <label class="flex cursor-pointer items-center justify-between gap-3 text-sm">
      <span class="flex items-center gap-2">
        {#if media.video}
          <VideoIcon class_="h-4 w-4" title="" />
        {:else}
          <VideoOffIcon class_="h-4 w-4" title="" />
        {/if}
        {m.groups_call_prejoin_camera_toggle()}
      </span>
      <input
        type="checkbox"
        class="toggle toggle-primary toggle-sm"
        bind:checked={media.video}
        disabled={pv.cameraStarting}
        data-testid="call-prejoin-camera"
      />
    </label>
    {#if cameraHint}<p class="text-xs text-error" data-testid="call-prejoin-camera-error">
        {cameraHint}
      </p>{/if}
  </div>

  <div class="grid gap-2 sm:grid-cols-2">
    <label class="flex flex-col gap-1 text-xs">
      <span class="text-base-content/70">{m.groups_call_select_microphone()}</span>
      <select
        class="select-bordered select w-full select-sm"
        value={pv.activeAudioDeviceId}
        onchange={(e) => switchPreviewDevice('audioinput', e.currentTarget.value)}
        disabled={pv.audioInputDevices.length === 0}
        data-testid="call-prejoin-mic-device"
      >
        {#each pv.audioInputDevices as device (device.deviceId)}
          <option value={device.deviceId}>{device.label || m.groups_call_unknown_device()}</option>
        {:else}
          <option value="">{m.groups_call_unknown_device()}</option>
        {/each}
      </select>
    </label>
    <label class="flex flex-col gap-1 text-xs">
      <span class="text-base-content/70">{m.groups_call_select_camera()}</span>
      <select
        class="select-bordered select w-full select-sm"
        value={pv.activeVideoDeviceId}
        onchange={(e) => switchPreviewDevice('videoinput', e.currentTarget.value)}
        disabled={pv.videoInputDevices.length === 0}
        data-testid="call-prejoin-camera-device"
      >
        {#each pv.videoInputDevices as device (device.deviceId)}
          <option value={device.deviceId}>{device.label || m.groups_call_unknown_device()}</option>
        {:else}
          <option value="">{m.groups_call_unknown_device()}</option>
        {/each}
      </select>
    </label>
    {#if speakerSelectable && pv.audioOutputDevices.length > 0}
      <label class="flex flex-col gap-1 text-xs sm:col-span-2">
        <span class="text-base-content/70">{m.groups_call_select_speaker()}</span>
        <select
          class="select-bordered select w-full select-sm"
          value={pv.activeAudioOutputDeviceId}
          onchange={(e) => switchPreviewDevice('audiooutput', e.currentTarget.value)}
          data-testid="call-prejoin-speaker-device"
        >
          {#each pv.audioOutputDevices as device (device.deviceId)}
            <option value={device.deviceId}>{device.label || m.groups_call_unknown_device()}</option
            >
          {/each}
        </select>
      </label>
    {/if}
  </div>

  {#if children}{@render children()}{/if}
  {#if error}<p class="text-sm text-error" data-testid="call-prejoin-error">{error}</p>{/if}

  <div class="flex flex-wrap items-center justify-end gap-2">
    {#if onCancel}
      <button
        type="button"
        class="btn btn-ghost"
        onclick={onCancel}
        disabled={joining}
        data-testid="call-prejoin-cancel"
      >
        {m.common_cancel()}
      </button>
    {/if}
    <button type="submit" class="btn btn-primary" disabled={joining || busy} data-testid={testid}>
      {#if joining || busy}<span class="loading loading-sm loading-spinner"></span>{/if}
      {joinLabel}
    </button>
  </div>
</form>
