// @ts-nocheck
/**
 * call-background — the camera background effect: which effects exist
 * (none, blur, a bundled preset image, the user's own image), how a stored
 * value is validated, and how an effect maps onto the options of
 * @livekit/track-processors' BackgroundProcessor. Everything the processor
 * loads comes from this app's own origin (self-hosted MediaPipe assets).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import {
  BACKGROUND_PRESETS,
  BLUR_RADIUS,
  MEDIAPIPE_ASSET_PATHS,
  MEDIAPIPE_TASKS_VISION_VERSION,
  backgroundProcessorOptions,
  parseBackgroundEffect
} from '$lib/groups/call-background.js';

describe('parseBackgroundEffect', () => {
  it('accepts none, blur, custom and every bundled preset', () => {
    expect(parseBackgroundEffect('none')).toBe('none');
    expect(parseBackgroundEffect('blur')).toBe('blur');
    expect(parseBackgroundEffect('custom')).toBe('custom');
    for (const preset of BACKGROUND_PRESETS) {
      expect(parseBackgroundEffect(`preset:${preset.id}`)).toBe(`preset:${preset.id}`);
    }
  });

  it('falls back to none for anything else (stale or tampered storage)', () => {
    expect(parseBackgroundEffect(null)).toBe('none');
    expect(parseBackgroundEffect('')).toBe('none');
    expect(parseBackgroundEffect('preset:gone')).toBe('none');
    expect(parseBackgroundEffect('sparkles')).toBe('none');
  });
});

describe('backgroundProcessorOptions', () => {
  it('maps none to null (no processor at all)', () => {
    expect(backgroundProcessorOptions('none', null)).toBeNull();
  });

  it('maps blur to the fixed blur radius', () => {
    expect(backgroundProcessorOptions('blur', null)).toEqual({
      mode: 'background-blur',
      blurRadius: BLUR_RADIUS
    });
  });

  it('maps a preset to its self-hosted image', () => {
    const preset = BACKGROUND_PRESETS[0];
    const opts = backgroundProcessorOptions(`preset:${preset.id}`, null);
    expect(opts).toEqual({ mode: 'virtual-background', imagePath: preset.src });
    expect(preset.src.startsWith('/')).toBe(true);
  });

  it('maps custom to the stored image, or to null when none is stored', () => {
    expect(backgroundProcessorOptions('custom', 'data:image/jpeg;base64,AAAA')).toEqual({
      mode: 'virtual-background',
      imagePath: 'data:image/jpeg;base64,AAAA'
    });
    expect(backgroundProcessorOptions('custom', null)).toBeNull();
  });
});

describe('self-hosted MediaPipe assets', () => {
  it('points the wasm file set and the model at this origin, never a CDN', () => {
    expect(MEDIAPIPE_ASSET_PATHS.tasksVisionFileSet).toBe(
      `/mediapipe/tasks-vision-${MEDIAPIPE_TASKS_VISION_VERSION}/wasm`
    );
    expect(MEDIAPIPE_ASSET_PATHS.modelAssetPath).toBe('/mediapipe/selfie_segmenter.tflite');
  });
});
