// @ts-nocheck
/**
 * Pre-join preview — device lists are deduped by deviceId before they are
 * stored. Firefox hands out every device of a kind with deviceId "" until a
 * capture permission has been granted; the lobby's keyed pickers would
 * throw each_key_duplicate on that shape and take the call route down.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { devices } = vi.hoisted(() => ({
  devices: { audioinput: [], audiooutput: [], videoinput: [] }
}));

vi.mock('@livekit/track-processors', () => ({
  BackgroundProcessor: vi.fn(() => ({ switchTo: vi.fn(async () => {}) }))
}));

vi.mock('livekit-client', () => ({
  Room: { getLocalDevices: vi.fn(async (kind) => devices[kind]) },
  createLocalVideoTrack: vi.fn(),
  createLocalAudioTrack: vi.fn(),
  createAudioAnalyser: vi.fn()
}));

const svc = await import('$lib/services/call-preview.svelte.js');
const state = svc.getCallPreviewState();

const dev = (kind, deviceId, label = '') => ({ kind, deviceId, label, groupId: '' });

beforeEach(() => {
  svc.stopPreview();
  localStorage.clear();
});

describe('call preview — device enumeration', () => {
  it('keeps one entry per deviceId, the empty Firefox placeholder included', async () => {
    devices.audioinput = [
      dev('audioinput', ''),
      dev('audioinput', ''),
      dev('audioinput', ''),
      dev('audioinput', 'mic-1', 'Headset'),
      dev('audioinput', 'mic-1', 'Headset again')
    ];
    devices.audiooutput = [dev('audiooutput', ''), dev('audiooutput', '')];
    devices.videoinput = [dev('videoinput', ''), dev('videoinput', 'cam-1', 'Webcam')];

    await svc.refreshPreviewDevices();

    expect(state.audioInputDevices.map((d) => d.deviceId)).toEqual(['', 'mic-1']);
    expect(state.audioOutputDevices.map((d) => d.deviceId)).toEqual(['']);
    expect(state.videoInputDevices.map((d) => d.deviceId)).toEqual(['', 'cam-1']);
    // The active id stays whatever the browser handed out (here the placeholder).
    expect(state.activeAudioDeviceId).toBe('');
  });
});
