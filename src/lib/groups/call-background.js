// Camera background effects for calls: blur, or a virtual background (a
// bundled preset or the user's own image). The work happens in the sender's
// browser via @livekit/track-processors (MediaPipe selfie segmentation), so
// everyone else just receives the processed video — no relay or SFU change.
//
// Every file the processor loads comes from this app's own origin: the
// MediaPipe wasm file set is served from node_modules by
// scripts/vite-plugin-mediapipe-wasm.js, the segmentation model and the
// preset images live in static/. The package's defaults would fetch them
// from jsdelivr and Google Cloud Storage on every enable.

/**
 * The effect, as stored per device: 'none' | 'blur' | 'custom' | 'preset:<id>'.
 * @typedef {string} BackgroundEffect
 */

// Must equal the @mediapipe/tasks-vision version @livekit/track-processors
// pins: the wasm glue and the JS bundle are released in lockstep. A test and
// the Vite plugin both fail when a bump drifts.
export const MEDIAPIPE_TASKS_VISION_VERSION = '0.10.14';

export const MEDIAPIPE_ASSET_PATHS = {
  tasksVisionFileSet: `/mediapipe/tasks-vision-${MEDIAPIPE_TASKS_VISION_VERSION}/wasm`,
  modelAssetPath: '/mediapipe/selfie_segmenter.tflite'
};

// One fixed strength for now (laoc, 2026-10-05); the package default is 10.
export const BLUR_RADIUS = 10;

/** Self-drawn images (no third-party material), 1280×720. */
export const BACKGROUND_PRESETS = [
  { id: 'paper', src: '/call-backgrounds/paper.svg' },
  { id: 'teal', src: '/call-backgrounds/teal.svg' },
  { id: 'shelf', src: '/call-backgrounds/shelf.svg' }
];

/**
 * @param {unknown} value
 * @returns {BackgroundEffect}
 */
export function parseBackgroundEffect(value) {
  if (value === 'blur' || value === 'custom') return value;
  if (typeof value === 'string' && value.startsWith('preset:')) {
    const id = value.slice('preset:'.length);
    if (BACKGROUND_PRESETS.some((p) => p.id === id)) return value;
  }
  return 'none';
}

/**
 * BackgroundProcessor options for an effect (without assetPaths), or null
 * when the camera should run without a processor.
 * @param {BackgroundEffect} effect
 * @param {string | null} customImage data URL of the own image, if any
 * @returns {{mode: 'background-blur', blurRadius: number} | {mode: 'virtual-background', imagePath: string} | null}
 */
export function backgroundProcessorOptions(effect, customImage) {
  if (effect === 'blur') return { mode: 'background-blur', blurRadius: BLUR_RADIUS };
  if (effect === 'custom') {
    return customImage ? { mode: 'virtual-background', imagePath: customImage } : null;
  }
  if (effect.startsWith('preset:')) {
    const preset = BACKGROUND_PRESETS.find((p) => p.id === effect.slice('preset:'.length));
    return preset ? { mode: 'virtual-background', imagePath: preset.src } : null;
  }
  return null;
}

/**
 * Whether this browser can run the processor — the same checks as the
 * package's supportsBackgroundProcessors(), kept here so the UI can decide
 * without loading the package. Fast path: insertable streams (Chromium);
 * fallback: canvas.captureStream (Firefox, Safari).
 */
export function backgroundEffectsSupported() {
  if (typeof document === 'undefined') return false;
  if (
    typeof OffscreenCanvas === 'undefined' ||
    typeof VideoFrame === 'undefined' ||
    typeof createImageBitmap === 'undefined'
  ) {
    return false;
  }
  try {
    if (!document.createElement('canvas').getContext('webgl2')) return false;
  } catch {
    return false;
  }
  const g = /** @type {any} */ (globalThis);
  const insertable =
    typeof g.MediaStreamTrackGenerator !== 'undefined' &&
    typeof g.MediaStreamTrackProcessor !== 'undefined';
  return insertable || 'captureStream' in HTMLCanvasElement.prototype;
}

// The own image is downscaled before it is stored: it lives in localStorage
// (a few MB per origin) and the processor draws it at video size anyway.
const CUSTOM_MAX_WIDTH = 1280;
const CUSTOM_MAX_HEIGHT = 720;

/**
 * Read an image file into a downscaled JPEG data URL. Browser only; the file
 * never leaves this device.
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function imageFileToDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, CUSTOM_MAX_WIDTH / bitmap.width, CUSTOM_MAX_HEIGHT / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}
