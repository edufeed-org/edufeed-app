<!--
  QrScanner — rear-camera preview that reports every QR code it reads
  (issue 9f7816e3). The parent decides what a code means: `onResult(text)`
  returns true when it handled the code (the scanner then stops) and false
  to keep scanning. The same code is not reported twice in a row, so a
  rejected code does not fire a toast on every frame.

  Decoding goes through `qr-decoder.js` (native BarcodeDetector, jsQR
  fallback). When the camera cannot be used — refused, missing, insecure
  context, desktop without a webcam — the picture input stays as the way in:
  on phones `capture="environment"` opens the camera app, elsewhere a file.
-->
<script>
  import { onDestroy } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import {
    createQrDecoder,
    grabVideoFrame,
    imageFileToImageData
  } from '$lib/helpers/qr-decoder.js';
  import { PhotoIcon } from '$lib/components/icons';

  /**
   * @type {{
   *   onResult: (text: string) => boolean,
   *   onCancel: () => void,
   *   intervalMs?: number
   * }}
   */
  let { onResult, onCancel, intervalMs = 150 } = $props();

  /** @type {HTMLVideoElement | undefined} */
  let video = $state(undefined);
  /** @type {HTMLCanvasElement | undefined} */
  let canvas;
  /** @type {'starting' | 'live' | 'failed'} */
  let camera = $state('starting');
  let cameraError = $state('');
  let imageError = $state('');
  let decoding = $state(false);

  /** @type {MediaStream | null} */
  let stream = null;
  /** @type {Promise<import('$lib/helpers/qr-decoder.js').QrDecoder> | null} */
  let decoderPromise = null;
  let stopped = false;
  let lastReported = '';
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  function decoder() {
    decoderPromise ??= createQrDecoder();
    return decoderPromise;
  }

  function scratchCanvas() {
    canvas ??= document.createElement('canvas');
    return canvas;
  }

  /**
   * @param {string | null} text
   * @returns {boolean} whether the parent took the code
   */
  function report(text) {
    if (!text || text === lastReported) return false;
    lastReported = text;
    const handled = onResult(text);
    if (handled) stop();
    return handled;
  }

  function stop() {
    stopped = true;
    clearTimeout(timer);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  async function startCamera() {
    const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!mediaDevices?.getUserMedia) {
      fail(m.profile_qr_scan_camera_missing());
      return;
    }
    try {
      stream = await mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
    } catch (err) {
      fail(cameraErrorMessage(err));
      return;
    }
    if (stopped || !video) {
      stop();
      return;
    }
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      // Autoplay refusal: the frame loop still reads whatever the element shows.
    }
    camera = 'live';
    loop();
  }

  /** @param {string} message */
  function fail(message) {
    camera = 'failed';
    cameraError = message;
  }

  /** @param {unknown} err */
  function cameraErrorMessage(err) {
    const name = /** @type {{name?: string}} */ (err ?? {}).name ?? '';
    if (name === 'NotAllowedError' || name === 'SecurityError')
      return m.profile_qr_scan_camera_denied();
    if (name === 'NotFoundError' || name === 'OverconstrainedError')
      return m.profile_qr_scan_camera_missing();
    return m.profile_qr_scan_camera_failed();
  }

  async function loop() {
    if (stopped || !video) return;
    const frame = grabVideoFrame(video, scratchCanvas());
    if (frame) {
      try {
        const text = await (await decoder()).decode(frame);
        if (stopped) return;
        if (report(text)) return;
      } catch (err) {
        console.error('QR decode failed', err);
      }
    }
    if (!stopped) timer = setTimeout(loop, intervalMs);
  }

  /** @param {Event} event */
  async function onPickImage(event) {
    const input = /** @type {HTMLInputElement} */ (event.currentTarget);
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    imageError = '';
    decoding = true;
    try {
      const frame = await imageFileToImageData(file, scratchCanvas());
      const text = frame ? await (await decoder()).decode(frame) : null;
      if (!text) {
        imageError = m.profile_qr_scan_image_no_code();
        return;
      }
      lastReported = '';
      report(text);
    } catch (err) {
      console.error('QR image decode failed', err);
      imageError = m.profile_qr_scan_image_no_code();
    } finally {
      decoding = false;
    }
  }

  $effect(() => {
    if (!video) return;
    startCamera();
  });

  onDestroy(stop);
</script>

<div class="flex flex-col gap-3" data-testid="qr-scanner">
  <div
    class="relative aspect-square w-full overflow-hidden rounded-xl bg-black"
    class:hidden={camera === 'failed'}
  >
    <video bind:this={video} class="h-full w-full object-cover" playsinline muted autoplay></video>
    {#if camera === 'starting'}
      <div class="absolute inset-0 flex items-center justify-center text-sm text-white/80">
        <span class="loading mr-2 loading-sm loading-spinner"></span>
        {m.profile_qr_scan_starting()}
      </div>
    {:else}
      <div
        class="pointer-events-none absolute inset-[12%] rounded-2xl border-2 border-white/70"
      ></div>
    {/if}
  </div>

  {#if camera === 'failed'}
    <p
      class="rounded-lg bg-warning/15 p-3 text-sm text-base-content"
      data-testid="qr-scanner-error"
    >
      {cameraError}
    </p>
  {:else}
    <p class="text-center text-sm text-base-content/70">{m.profile_qr_scan_hint()}</p>
  {/if}

  {#if imageError}
    <p class="text-center text-sm text-error" data-testid="qr-scanner-image-error">{imageError}</p>
  {/if}

  <div class="flex flex-wrap items-center justify-between gap-2">
    <button type="button" class="btn btn-ghost btn-sm" onclick={onCancel}>
      {m.common_back()}
    </button>
    <label class="btn btn-outline btn-sm" class:btn-disabled={decoding}>
      {#if decoding}
        <span class="loading loading-xs loading-spinner"></span>
      {:else}
        <PhotoIcon class_="w-4 h-4" />
      {/if}
      {m.profile_qr_scan_pick_image()}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        class="hidden"
        data-testid="qr-scanner-file"
        onchange={onPickImage}
      />
    </label>
  </div>
</div>
