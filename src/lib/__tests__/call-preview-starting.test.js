// @ts-nocheck
/**
 * Pre-join preview — the "starting" flags behind the lobby's camera and
 * microphone toggles. A flag belongs to the capture in flight: it must
 * clear when that capture ends, however it ends. A release that lands while
 * the capture is still pending (the user closes the lobby, or toggles off
 * before the browser answered) must not leave the toggle disabled with a
 * permanent spinner, and a second "on" while the first is pending must not
 * cancel the capture that is about to succeed.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { pending } = vi.hoisted(() => ({ pending: { video: [], audio: [] } }));

vi.mock('@livekit/track-processors', () => ({
  BackgroundProcessor: vi.fn(() => ({ switchTo: vi.fn(async () => {}) }))
}));

vi.mock('livekit-client', () => {
  class FakeVideoTrack {
    setProcessor = vi.fn(async () => {});
    stopProcessor = vi.fn(async () => {});
    getProcessor = vi.fn(() => undefined);
    stop = vi.fn();
    restartTrack = vi.fn(async () => {});
    getDeviceId = vi.fn(async () => 'cam1');
  }
  class FakeAudioTrack {
    stop = vi.fn();
    restartTrack = vi.fn(async () => {});
    getDeviceId = vi.fn(async () => 'mic1');
  }
  const deferred = (list, make) =>
    new Promise((resolve) => {
      const track = make();
      list.push({ track, resolve: () => resolve(track) });
    });
  return {
    Room: { getLocalDevices: vi.fn(async () => []) },
    createLocalVideoTrack: vi.fn(() => deferred(pending.video, () => new FakeVideoTrack())),
    createLocalAudioTrack: vi.fn(() => deferred(pending.audio, () => new FakeAudioTrack())),
    createAudioAnalyser: vi.fn(() => ({
      analyser: { context: { state: 'running' } },
      calculateVolume: () => 0,
      cleanup: vi.fn(async () => {})
    }))
  };
});

const svc = await import('$lib/services/call-preview.svelte.js');
const state = svc.getCallPreviewState();

beforeEach(() => {
  svc.stopPreview();
  pending.video.length = 0;
  pending.audio.length = 0;
});

describe('call preview — starting flags', () => {
  it('a release during a pending camera capture clears the starting flag', async () => {
    const opening = svc.setPreviewCamera(true);
    expect(state.cameraStarting).toBe(true);
    await svc.setPreviewCamera(false);
    pending.video[0].resolve();
    await opening;
    expect(state.cameraStarting).toBe(false);
    expect(state.videoTrack).toBeNull();
    expect(pending.video[0].track.stop).toHaveBeenCalled();
  });

  it('a second "on" during a pending camera capture does not cancel it', async () => {
    const opening = svc.setPreviewCamera(true);
    const again = svc.setPreviewCamera(true);
    pending.video[0].resolve();
    await Promise.all([opening, again]);
    expect(pending.video).toHaveLength(1);
    expect(state.videoTrack).toBe(pending.video[0].track);
    expect(state.cameraStarting).toBe(false);
  });

  it('a release during a pending microphone capture clears the starting flag', async () => {
    const opening = svc.setPreviewMic(true);
    expect(state.micStarting).toBe(true);
    await svc.setPreviewMic(false);
    pending.audio[0].resolve();
    await opening;
    expect(state.micStarting).toBe(false);
    expect(state.audioTrack).toBeNull();
    expect(pending.audio[0].track.stop).toHaveBeenCalled();
  });
});
