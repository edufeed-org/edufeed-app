// @ts-nocheck
/**
 * LiveKit Connection Service — join behaviour and media controls.
 *
 * - joins MUTED with the camera off (nobody is on air by surprise);
 * - unmuting first resumes audio playback when the browser suspended it,
 *   and uses the remembered mic + processing flags;
 * - a failing mic/camera throws to the caller (the UI toasts) and leaves
 *   the state unchanged instead of silently pretending to be live;
 * - a cancelled screen-share picker is not an error;
 * - the Room is built with the remembered devices and Web Audio mixing
 *   (per-person volume above 100 % needs it);
 * - switching a device remembers it for the next call;
 * - cue sounds on join / remote join / leave / mute / unmute.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rooms, sounds } = vi.hoisted(() => ({
  rooms: [],
  sounds: {
    playJoinSound: vi.fn(),
    playLeaveSound: vi.fn(),
    playMuteSound: vi.fn(),
    playUnmuteSound: vi.fn(),
    playScreenShareSound: vi.fn()
  }
}));

vi.mock('$lib/services/call-sounds.js', () => sounds);

vi.mock('livekit-client', () => {
  const RoomEvent = {
    Connected: 'connected',
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
    startAudio = vi.fn(async () => {
      this.canPlaybackAudio = true;
    });
    switchActiveDevice = vi.fn(async () => true);
    localParticipant = {
      identity: 'local',
      setMicrophoneEnabled: vi.fn(async () => {}),
      setCameraEnabled: vi.fn(async () => {}),
      setScreenShareEnabled: vi.fn(async () => {}),
      getTrackPublication: vi.fn(() => undefined),
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
    emit(event, ...args) {
      for (const h of this.handlers[event] ?? []) h(...args);
    }
    async connect() {}
    async disconnect() {}
    static getLocalDevices = vi.fn(async () => []);
  }
  return { Room: MockRoom, RoomEvent, Track };
});

const { RoomEvent } = await import('livekit-client');
const svc = await import('$lib/services/livekit-connection.svelte.js');
const prefs = await import('$lib/services/call-prefs.js');

beforeEach(async () => {
  await svc.disconnectFromRoom();
  rooms.length = 0;
  localStorage.clear();
  for (const fn of Object.values(sounds)) fn.mockClear();
});

describe('join', () => {
  it('joins muted with the camera off and plays the join cue', async () => {
    await svc.connectToRoom('t', 'wss://lk');
    const room = rooms[0];
    const state = svc.getLiveKitState();
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(room.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
    expect(state.isMuted).toBe(true);
    expect(state.isCameraOff).toBe(true);
    expect(sounds.playJoinSound).toHaveBeenCalledTimes(1);
  });

  it('builds the Room with remembered devices, processing flags and Web Audio mixing', async () => {
    prefs.rememberDevice('audioinput', 'mic-1');
    prefs.rememberDevice('videoinput', 'cam-2');
    prefs.setAudioProcessing({ echoCancellation: false });
    await svc.connectToRoom('t', 'wss://lk');
    const { options } = rooms[0];
    expect(options.webAudioMix).toBe(true);
    expect(options.audioCaptureDefaults).toEqual(
      expect.objectContaining({ deviceId: 'mic-1', echoCancellation: false, channelCount: 1 })
    );
    expect(options.videoCaptureDefaults).toEqual({ deviceId: 'cam-2' });
  });

  it('switches to the remembered speaker after connecting', async () => {
    prefs.rememberDevice('audiooutput', 'spk-3');
    await svc.connectToRoom('t', 'wss://lk');
    expect(rooms[0].switchActiveDevice).toHaveBeenCalledWith('audiooutput', 'spk-3');
  });
});

describe('microphone', () => {
  it('unmuting resumes suspended audio playback first, then enables the mic', async () => {
    await svc.connectToRoom('t', 'wss://lk');
    const room = rooms[0];
    room.canPlaybackAudio = false;
    await svc.toggleMute();
    expect(room.startAudio).toHaveBeenCalled();
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ channelCount: 1 })
    );
    expect(svc.getLiveKitState().isMuted).toBe(false);
    expect(sounds.playUnmuteSound).toHaveBeenCalledTimes(1);

    await svc.toggleMute();
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    expect(svc.getLiveKitState().isMuted).toBe(true);
    expect(sounds.playMuteSound).toHaveBeenCalledTimes(1);
  });

  it('a failing mic throws and the call stays muted', async () => {
    await svc.connectToRoom('t', 'wss://lk');
    const room = rooms[0];
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    room.localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(denied);
    await expect(svc.toggleMute()).rejects.toBe(denied);
    expect(svc.getLiveKitState().isMuted).toBe(true);
  });
});

describe('camera and screen share', () => {
  it('a failing camera throws and the camera stays off', async () => {
    await svc.connectToRoom('t', 'wss://lk');
    const room = rooms[0];
    const busy = Object.assign(new Error('Could not start video source'), {
      name: 'NotReadableError'
    });
    room.localParticipant.setCameraEnabled.mockRejectedValueOnce(busy);
    await expect(svc.toggleCamera()).rejects.toBe(busy);
    expect(svc.getLiveKitState().isCameraOff).toBe(true);
  });

  it('a cancelled screen-share picker is not an error', async () => {
    await svc.connectToRoom('t', 'wss://lk');
    const room = rooms[0];
    room.localParticipant.setScreenShareEnabled.mockRejectedValueOnce(
      Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
    );
    await expect(svc.toggleScreenShare()).resolves.toBeUndefined();
    expect(svc.getLiveKitState().isScreenSharing).toBe(false);
  });

  it('a system-level screen capture denial is surfaced', async () => {
    await svc.connectToRoom('t', 'wss://lk');
    const room = rooms[0];
    const denied = Object.assign(new Error('Permission denied by system'), {
      name: 'NotAllowedError'
    });
    room.localParticipant.setScreenShareEnabled.mockRejectedValueOnce(denied);
    await expect(svc.toggleScreenShare()).rejects.toBe(denied);
  });
});

describe('devices and cues', () => {
  it('remembers a switched device for the next call', async () => {
    await svc.connectToRoom('t', 'wss://lk');
    await svc.switchAudioDevice('mic-9');
    await svc.switchVideoDevice('cam-9');
    await svc.switchAudioOutputDevice('spk-9');
    expect(prefs.getPreferredDevice('audioinput')).toBe('mic-9');
    expect(prefs.getPreferredDevice('videoinput')).toBe('cam-9');
    expect(prefs.getPreferredDevice('audiooutput')).toBe('spk-9');
  });

  it('plays a cue when someone else joins or leaves, debouncing a burst of joins', async () => {
    vi.useFakeTimers();
    try {
      await svc.connectToRoom('t', 'wss://lk');
      const room = rooms[0];
      sounds.playJoinSound.mockClear();
      room.emit(RoomEvent.ParticipantConnected, { identity: 'b'.repeat(64) + ':x1' });
      room.emit(RoomEvent.ParticipantConnected, { identity: 'c'.repeat(64) + ':x2' });
      expect(sounds.playJoinSound).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(800);
      room.emit(RoomEvent.ParticipantConnected, { identity: 'd'.repeat(64) + ':x3' });
      expect(sounds.playJoinSound).toHaveBeenCalledTimes(2);
      room.emit(RoomEvent.ParticipantDisconnected, { identity: 'd'.repeat(64) + ':x3' });
      expect(sounds.playLeaveSound).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
