// @ts-nocheck
/**
 * LiveKit Connection Service — camera background effects (blur, virtual
 * background) through @livekit/track-processors.
 *
 * - the chosen effect is remembered on this device, also while the camera
 *   is off, and applied as soon as the camera goes on;
 * - switching between effects reuses the running processor (switchTo)
 *   instead of rebuilding the MediaPipe pipeline;
 * - "none" removes the processor, so no frame is touched;
 * - the processor is pointed at the self-hosted MediaPipe assets;
 * - a failing processor throws (the UI toasts) and the previous effect stays.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rooms, processors } = vi.hoisted(() => ({ rooms: [], processors: [] }));

vi.mock('$lib/services/call-sounds.js', () => ({
  playJoinSound: vi.fn(),
  playLeaveSound: vi.fn(),
  playMuteSound: vi.fn(),
  playUnmuteSound: vi.fn(),
  playScreenShareSound: vi.fn()
}));

vi.mock('@livekit/track-processors', () => ({
  BackgroundProcessor: vi.fn((options) => {
    const processor = { options, switchTo: vi.fn(async () => {}) };
    processors.push(processor);
    return processor;
  })
}));

vi.mock('livekit-client', () => {
  const RoomEvent = {
    ParticipantConnected: 'participantConnected',
    ParticipantDisconnected: 'participantDisconnected',
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    LocalTrackPublished: 'localTrackPublished',
    LocalTrackUnpublished: 'localTrackUnpublished',
    ActiveSpeakersChanged: 'activeSpeakersChanged',
    ParticipantPermissionsChanged: 'participantPermissionsChanged',
    Disconnected: 'disconnected',
    Reconnecting: 'reconnecting',
    Reconnected: 'reconnected'
  };
  const Track = {
    Source: {
      Camera: 'camera',
      Microphone: 'microphone',
      ScreenShare: 'screen_share',
      ScreenShareAudio: 'screen_share_audio'
    }
  };
  class MockRoom {
    handlers = {};
    canPlaybackAudio = true;
    startAudio = vi.fn(async () => {});
    switchActiveDevice = vi.fn(async () => true);
    cameraTrack = {
      processor: undefined,
      setProcessor: vi.fn(async (p) => {
        this.cameraTrack.processor = p;
      }),
      stopProcessor: vi.fn(async () => {
        this.cameraTrack.processor = undefined;
      }),
      getProcessor: vi.fn(() => this.cameraTrack.processor)
    };
    cameraOn = false;
    localParticipant = {
      identity: 'local',
      setMicrophoneEnabled: vi.fn(async () => {}),
      setCameraEnabled: vi.fn(async (on) => {
        this.cameraOn = on;
      }),
      setScreenShareEnabled: vi.fn(async () => {}),
      getTrackPublication: vi.fn((source) =>
        source === 'camera' && this.cameraOn ? { track: this.cameraTrack } : undefined
      ),
      activeDeviceMap: new Map()
    };
    remoteParticipants = new Map();
    constructor(options) {
      this.options = options;
      rooms.push(this);
    }
    on(event, handler) {
      (this.handlers[event] ??= []).push(handler);
      return this;
    }
    async connect() {}
    async disconnect() {}
    static getLocalDevices = vi.fn(async () => []);
  }
  return { Room: MockRoom, RoomEvent, Track };
});

const { BackgroundProcessor } = await import('@livekit/track-processors');
const svc = await import('$lib/services/livekit-connection.svelte.js');
const prefs = await import('$lib/services/call-prefs.js');
const { BACKGROUND_PRESETS, BLUR_RADIUS, MEDIAPIPE_ASSET_PATHS } = await import(
  '$lib/groups/call-background.js'
);

beforeEach(async () => {
  await svc.disconnectFromRoom();
  rooms.length = 0;
  processors.length = 0;
  BackgroundProcessor.mockClear();
  localStorage.clear();
});

const preset = () => BACKGROUND_PRESETS[0];

describe('camera background effects', () => {
  it('remembers the effect while the camera is off and builds no processor yet', async () => {
    await svc.connectToRoom('t', 'wss://lk');
    await svc.setCameraBackground('blur');
    expect(svc.getLiveKitState().backgroundEffect).toBe('blur');
    expect(prefs.getBackgroundEffect()).toBe('blur');
    expect(BackgroundProcessor).not.toHaveBeenCalled();
  });

  it('applies the remembered effect when the camera goes on, with self-hosted assets', async () => {
    prefs.setBackgroundEffect('blur');
    await svc.connectToRoom('t', 'wss://lk');
    await svc.toggleCamera();
    const room = rooms[0];
    expect(BackgroundProcessor).toHaveBeenCalledWith({
      mode: 'background-blur',
      blurRadius: BLUR_RADIUS,
      assetPaths: MEDIAPIPE_ASSET_PATHS
    });
    expect(room.cameraTrack.setProcessor).toHaveBeenCalledWith(processors[0]);
  });

  it('applies the effect to a camera that is already on', async () => {
    await svc.connectToRoom('t', 'wss://lk');
    await svc.toggleCamera();
    expect(BackgroundProcessor).not.toHaveBeenCalled();
    await svc.setCameraBackground(`preset:${preset().id}`);
    expect(BackgroundProcessor).toHaveBeenCalledWith({
      mode: 'virtual-background',
      imagePath: preset().src,
      assetPaths: MEDIAPIPE_ASSET_PATHS
    });
    expect(rooms[0].cameraTrack.setProcessor).toHaveBeenCalledTimes(1);
  });

  it('switches effects on the running processor instead of rebuilding it', async () => {
    prefs.setBackgroundEffect('blur');
    await svc.connectToRoom('t', 'wss://lk');
    await svc.toggleCamera();
    await svc.setCameraBackground(`preset:${preset().id}`);
    expect(BackgroundProcessor).toHaveBeenCalledTimes(1);
    expect(processors[0].switchTo).toHaveBeenCalledWith({
      mode: 'virtual-background',
      imagePath: preset().src
    });
  });

  it('none removes the processor', async () => {
    prefs.setBackgroundEffect('blur');
    await svc.connectToRoom('t', 'wss://lk');
    await svc.toggleCamera();
    await svc.setCameraBackground('none');
    expect(rooms[0].cameraTrack.stopProcessor).toHaveBeenCalledTimes(1);
    expect(svc.getLiveKitState().backgroundEffect).toBe('none');
  });

  it('uses the own image kept on this device', async () => {
    prefs.setCustomBackground('data:image/jpeg;base64,AAAA');
    await svc.connectToRoom('t', 'wss://lk');
    await svc.toggleCamera();
    await svc.setCameraBackground('custom');
    expect(BackgroundProcessor).toHaveBeenCalledWith({
      mode: 'virtual-background',
      imagePath: 'data:image/jpeg;base64,AAAA',
      assetPaths: MEDIAPIPE_ASSET_PATHS
    });
  });

  it('a failing processor throws and the previous effect stays', async () => {
    await svc.connectToRoom('t', 'wss://lk');
    await svc.toggleCamera();
    const failure = new Error('webgl2 unavailable');
    rooms[0].cameraTrack.setProcessor.mockRejectedValueOnce(failure);
    await expect(svc.setCameraBackground('blur')).rejects.toBe(failure);
    expect(svc.getLiveKitState().backgroundEffect).toBe('none');
    expect(prefs.getBackgroundEffect()).toBe('none');
  });

  it('a failing effect never keeps the camera from going on', async () => {
    prefs.setBackgroundEffect('blur');
    await svc.connectToRoom('t', 'wss://lk');
    BackgroundProcessor.mockImplementationOnce(() => {
      throw new Error('Background transformer is not supported in this browser');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await svc.toggleCamera();
    expect(svc.getLiveKitState().isCameraOff).toBe(false);
    warn.mockRestore();
  });
});
