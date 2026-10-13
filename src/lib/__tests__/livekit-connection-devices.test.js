// @ts-nocheck
/**
 * LiveKit Connection Service — device lists are deduped by deviceId before
 * they are stored, on the first enumeration and on a devicechange refresh.
 * Firefox lists every device of a kind with deviceId "" before permission;
 * the in-call keyed pickers would throw each_key_duplicate on that shape.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { devices } = vi.hoisted(() => ({
  devices: { audioinput: [], audiooutput: [], videoinput: [] }
}));

vi.mock('$lib/services/call-sounds.js', () => ({
  playJoinSound: vi.fn(),
  playLeaveSound: vi.fn(),
  playMuteSound: vi.fn(),
  playUnmuteSound: vi.fn(),
  playScreenShareSound: vi.fn()
}));

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
    startAudio = vi.fn(async () => {});
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
    on(event, handler) {
      (this.handlers[event] ??= []).push(handler);
      return this;
    }
    async connect() {}
    async disconnect() {}
    static getLocalDevices = vi.fn(async (kind) => devices[kind]);
  }
  return { Room: MockRoom, RoomEvent, Track };
});

const svc = await import('$lib/services/livekit-connection.svelte.js');
const state = svc.getLiveKitState();

const dev = (kind, deviceId, label = '') => ({ kind, deviceId, label, groupId: '' });

beforeEach(async () => {
  await svc.disconnectFromRoom();
  localStorage.clear();
  devices.audioinput = [];
  devices.audiooutput = [];
  devices.videoinput = [];
});

describe('livekit connection — device enumeration', () => {
  it('dedupes the lists on connect', async () => {
    devices.audioinput = [
      dev('audioinput', ''),
      dev('audioinput', ''),
      dev('audioinput', 'mic-1', 'Headset'),
      dev('audioinput', 'mic-1', 'Headset again')
    ];
    devices.audiooutput = [dev('audiooutput', ''), dev('audiooutput', ''), dev('audiooutput', '')];
    devices.videoinput = [dev('videoinput', ''), dev('videoinput', '')];

    await svc.connectToRoom('t', 'wss://lk');

    expect(state.audioInputDevices.map((d) => d.deviceId)).toEqual(['', 'mic-1']);
    expect(state.audioOutputDevices.map((d) => d.deviceId)).toEqual(['']);
    expect(state.videoInputDevices.map((d) => d.deviceId)).toEqual(['']);
  });

  it('dedupes again on a devicechange refresh', async () => {
    await svc.connectToRoom('t', 'wss://lk');
    devices.audioinput = [dev('audioinput', 'a'), dev('audioinput', 'a'), dev('audioinput', 'b')];
    devices.videoinput = [dev('videoinput', ''), dev('videoinput', ''), dev('videoinput', 'c')];

    navigator.mediaDevices?.dispatchEvent?.(new Event('devicechange'));
    await svc.refreshAudioDevices();
    await svc.refreshVideoDevices();

    expect(state.audioInputDevices.map((d) => d.deviceId)).toEqual(['a', 'b']);
    expect(state.videoInputDevices.map((d) => d.deviceId)).toEqual(['', 'c']);
  });
});
