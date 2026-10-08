// @ts-nocheck
/**
 * Pre-join preview — the camera background effect in the lobby (smoke test
 * 2026-10-08: "set the blurred background already in the pre-meeting
 * component"). The preview track gets the same BackgroundProcessor the call
 * uses (groups/call-background-processor), so what the lobby shows is what
 * goes on air:
 *
 * - picking an effect is remembered on this device (the call reads the same
 *   key on connect), also while the lobby camera is off;
 * - the remembered effect goes on the preview camera when it opens, with
 *   the self-hosted MediaPipe assets;
 * - switching effects reuses the running processor (switchTo), "none"
 *   removes it;
 * - a failing processor keeps the previous effect, reports it, and never
 *   keeps the camera from showing;
 * - releasing the preview drops the processor — the next lobby starts clean.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { videoTracks, processors } = vi.hoisted(() => ({ videoTracks: [], processors: [] }));

vi.mock('@livekit/track-processors', () => ({
  BackgroundProcessor: vi.fn((options) => {
    const processor = { options, switchTo: vi.fn(async () => {}) };
    processors.push(processor);
    return processor;
  })
}));

vi.mock('livekit-client', () => {
  // A class instance like the real LocalVideoTrack: Svelte's $state leaves
  // class instances alone (a plain object would come back as a proxy).
  class FakeVideoTrack {
    processor = undefined;
    setProcessor = vi.fn(async (p) => {
      this.processor = p;
    });
    stopProcessor = vi.fn(async () => {
      this.processor = undefined;
    });
    getProcessor = vi.fn(() => this.processor);
    // livekit's LocalTrack.stop() destroys the processor itself
    stop = vi.fn(() => {
      this.processor = undefined;
    });
    // restartTrack keeps the processor (livekit re-runs it on the new track)
    restartTrack = vi.fn(async () => {});
    getDeviceId = vi.fn(async () => 'cam1');
    attach = vi.fn();
    detach = vi.fn();
  }
  function makeVideoTrack() {
    const track = new FakeVideoTrack();
    videoTracks.push(track);
    return track;
  }
  return {
    Room: { getLocalDevices: vi.fn(async () => []) },
    createLocalVideoTrack: vi.fn(async () => makeVideoTrack()),
    createLocalAudioTrack: vi.fn(async () => ({
      stop: vi.fn(),
      getDeviceId: vi.fn(async () => 'mic1'),
      restartTrack: vi.fn(async () => {})
    })),
    createAudioAnalyser: vi.fn(() => ({
      analyser: { context: { state: 'running' } },
      calculateVolume: () => 0,
      cleanup: vi.fn(async () => {})
    }))
  };
});

const { BackgroundProcessor } = await import('@livekit/track-processors');
const svc = await import('$lib/services/call-preview.svelte.js');
const prefs = await import('$lib/services/call-prefs.js');
const { BACKGROUND_PRESETS, BLUR_RADIUS, MEDIAPIPE_ASSET_PATHS } = await import(
  '$lib/groups/call-background.js'
);

const preset = () => BACKGROUND_PRESETS[0];
const state = svc.getCallPreviewState();

beforeEach(() => {
  svc.stopPreview();
  videoTracks.length = 0;
  processors.length = 0;
  BackgroundProcessor.mockClear();
  localStorage.clear();
  svc.syncPreviewBackground();
});

describe('call preview — background effect', () => {
  it('remembers the effect while the camera is off, without building a processor', async () => {
    await svc.setPreviewBackground('blur');
    expect(state.backgroundEffect).toBe('blur');
    expect(prefs.getBackgroundEffect()).toBe('blur');
    expect(BackgroundProcessor).not.toHaveBeenCalled();
  });

  it('starts from the effect remembered on this device', () => {
    prefs.setBackgroundEffect(`preset:${preset().id}`);
    svc.syncPreviewBackground();
    expect(state.backgroundEffect).toBe(`preset:${preset().id}`);
  });

  it('puts the remembered effect on the preview camera when it opens, with self-hosted assets', async () => {
    prefs.setBackgroundEffect('blur');
    svc.syncPreviewBackground();
    await svc.setPreviewCamera(true);
    expect(state.videoTrack).toBe(videoTracks[0]);
    expect(BackgroundProcessor).toHaveBeenCalledWith({
      mode: 'background-blur',
      blurRadius: BLUR_RADIUS,
      assetPaths: MEDIAPIPE_ASSET_PATHS
    });
    expect(videoTracks[0].setProcessor).toHaveBeenCalledWith(processors[0]);
  });

  it('applies a pick to the running preview right away and remembers it', async () => {
    await svc.setPreviewCamera(true);
    expect(BackgroundProcessor).not.toHaveBeenCalled();
    await svc.setPreviewBackground(`preset:${preset().id}`);
    expect(BackgroundProcessor).toHaveBeenCalledWith({
      mode: 'virtual-background',
      imagePath: preset().src,
      assetPaths: MEDIAPIPE_ASSET_PATHS
    });
    expect(videoTracks[0].setProcessor).toHaveBeenCalledTimes(1);
    expect(prefs.getBackgroundEffect()).toBe(`preset:${preset().id}`);
  });

  it('switches effects on the running processor instead of rebuilding it', async () => {
    await svc.setPreviewCamera(true);
    await svc.setPreviewBackground('blur');
    await svc.setPreviewBackground(`preset:${preset().id}`);
    expect(BackgroundProcessor).toHaveBeenCalledTimes(1);
    expect(processors[0].switchTo).toHaveBeenCalledWith({
      mode: 'virtual-background',
      imagePath: preset().src
    });
  });

  it('none removes the processor', async () => {
    await svc.setPreviewCamera(true);
    await svc.setPreviewBackground('blur');
    await svc.setPreviewBackground('none');
    expect(videoTracks[0].stopProcessor).toHaveBeenCalledTimes(1);
    expect(state.backgroundEffect).toBe('none');
    expect(prefs.getBackgroundEffect()).toBe('none');
  });

  it('uses the own image kept on this device', async () => {
    prefs.setCustomBackground('data:image/jpeg;base64,AAAA');
    await svc.setPreviewCamera(true);
    await svc.setPreviewBackground('custom');
    expect(BackgroundProcessor).toHaveBeenCalledWith({
      mode: 'virtual-background',
      imagePath: 'data:image/jpeg;base64,AAAA',
      assetPaths: MEDIAPIPE_ASSET_PATHS
    });
  });

  it('a failing processor keeps the previous effect and reports it', async () => {
    await svc.setPreviewCamera(true);
    const failure = new Error('webgl2 unavailable');
    videoTracks[0].setProcessor.mockRejectedValueOnce(failure);
    await svc.setPreviewBackground('blur');
    expect(state.backgroundEffect).toBe('none');
    expect(prefs.getBackgroundEffect()).toBe('none');
    expect(state.backgroundError).toBe(failure);
    // The camera itself stays on, and the next pick clears the report.
    expect(state.videoTrack).toBe(videoTracks[0]);
    await svc.setPreviewBackground('blur');
    expect(state.backgroundError).toBeNull();
    expect(state.backgroundEffect).toBe('blur');
  });

  it('a failing effect never keeps the preview camera from opening', async () => {
    prefs.setBackgroundEffect('blur');
    svc.syncPreviewBackground();
    BackgroundProcessor.mockImplementationOnce(() => {
      throw new Error('Background transformer is not supported in this browser');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await svc.setPreviewCamera(true);
    warn.mockRestore();
    expect(state.videoTrack).toBe(videoTracks[0]);
    expect(state.cameraError).toBeNull();
  });

  it('releasing the preview drops the processor; the next camera builds a fresh one', async () => {
    await svc.setPreviewCamera(true);
    await svc.setPreviewBackground('blur');
    svc.stopPreview();
    expect(videoTracks[0].stop).toHaveBeenCalled();
    expect(state.backgroundError).toBeNull();
    await svc.setPreviewCamera(true);
    expect(videoTracks.length).toBe(2);
    expect(BackgroundProcessor).toHaveBeenCalledTimes(2);
    expect(videoTracks[1].setProcessor).toHaveBeenCalledWith(processors[1]);
    expect(processors[0].switchTo).not.toHaveBeenCalled();
  });

  it('switching the camera device keeps the effect without a second processor', async () => {
    await svc.setPreviewCamera(true);
    await svc.setPreviewBackground('blur');
    await svc.switchPreviewDevice('videoinput', 'cam2');
    expect(videoTracks[0].restartTrack).toHaveBeenCalled();
    expect(BackgroundProcessor).toHaveBeenCalledTimes(1);
    expect(videoTracks[0].setProcessor).toHaveBeenCalledTimes(1);
  });
});
